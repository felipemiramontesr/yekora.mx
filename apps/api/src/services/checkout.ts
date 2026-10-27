/**
 * Checkout core (FC 012 F2): turns a validated cart and buyer into a pending order with its
 * stock reserved and a hosted payment session, following the truth tables in order.
 *
 * T1.1 ClientPayloadValid ⟺ K ∧ A ∧ C, evaluated K → A → C:
 *   K the chosen method's processor and the checkout secrets are configured, else 503
 *     SERVICE_UNAVAILABLE before reading anything else;
 *   A contact and address pass the shared schema and the state is one of the 32 zones, else
 *     400 INVALID_SHIPPING_ADDRESS;
 *   C the privacy box is ticked, else 400 PRIVACY_CONSENT_REQUIRED.
 * Then the cart must be quotable (400 EMPTY_OR_UNAVAILABLE_CART), and
 * T1.2 SessionCreated ⟺ D ∧ P ∧ I, evaluated D → P → I:
 *   D the FC 011 quote to the address's state prices shipping, else 400
 *     UNSERVICEABLE_DESTINATION;
 *   P the quoted total equals the one the buyer saw, else 409 PRICE_CHANGED;
 *   I every line's stock is reserved atomically, else 409 INSUFFICIENT_STOCK and nothing kept.
 *
 * Expired reservations are released lazily, in their own transaction, before each checkout and
 * order lookup: no cron and no public endpoint. The order commits before the processor is
 * called (no transaction held across the network); if the processor then fails, a
 * compensating transaction cancels the order and returns its stock (503).
 *
 * @module
 */
import {
  CHECKOUT_RETURN_PATHS,
  type CheckoutRequest,
  checkoutRequestSchema,
  PAYMENT_METHOD_CODES,
} from '../../../../lib/checkout/checkoutTypes';
import type { CheckoutSecrets, PaymentsConfig } from '../config';
import { quoteCartToDestination } from './cartQuote';
import {
  emailHmac,
  encryptPii,
  newAccessToken,
  newOrderNumber,
  type PiiField,
  tokenHash,
} from './checkoutCrypto';
import type { Db, Transactional, TxQuery } from './db';
import type { CurrentRate } from './exchangeRate';
import type { PaymentMethodCode, PaymentProcessorPort } from './paymentPort';
import type { ShippingRateProvider } from './shippingPort';

/** Processors by `payment_processors.code`. */
export type ProcessorCode = 'STRIPE' | 'MERCADO_PAGO';

/** Which processor collects each method (Ω, 112_AN). */
const PROCESSOR_OF: Record<PaymentMethodCode, ProcessorCode> = {
  CARD: 'STRIPE',
  OXXO: 'STRIPE',
  SPEI: 'MERCADO_PAGO',
  MERCADO_PAGO_BALANCE: 'MERCADO_PAGO',
};

/** Everything the checkout needs. */
export interface CheckoutDeps {
  /** Database with transactions. */
  db: Db & Transactional;
  /** Current FIX (cached). */
  rate: () => Promise<CurrentRate | null>;
  /** Shipping rates (FC 011). */
  shipping: ShippingRateProvider;
  /** Configured processors; a missing one makes its methods unavailable (K). */
  processors: Partial<Record<ProcessorCode, PaymentProcessorPort>>;
  /** Mode, URLs and checkout secrets. */
  payments: PaymentsConfig;
  /** Clock, injectable for tests. */
  now: () => Date;
}

/** Machine codes of a refused checkout, one per cause (T1.1, T1.2). */
type RefusalCode =
  | 'INVALID_REQUEST'
  | 'SERVICE_UNAVAILABLE'
  | 'INVALID_SHIPPING_ADDRESS'
  | 'PRIVACY_CONSENT_REQUIRED'
  | 'EMPTY_OR_UNAVAILABLE_CART'
  | 'UNSERVICEABLE_DESTINATION'
  | 'PRICE_CHANGED'
  | 'INSUFFICIENT_STOCK';

/** Outcome of one checkout attempt. */
type CheckoutOutcome =
  | {
      ok: true;
      session: {
        orderNumber: string;
        accessToken: string;
        redirectUrl: string;
        expiresAt: string;
        totalMxnCents: number;
      };
    }
  | { ok: false; status: 400 | 409 | 503; code: RefusalCode };

const refuse = (
  status: 400 | 409 | 503,
  code: RefusalCode
): CheckoutOutcome => ({ ok: false, status, code });

/** Rows changed by a write (mysql2 answers writes with a result header, not rows). */
function affected(result: unknown): number {
  return (result as { affectedRows: number }).affectedRows;
}

/**
 * Releases every pending reservation whose time is up: the orders become EXPIRED and their
 * units leave `reserved_stock`, in one transaction that locks exactly those orders.
 *
 * @param db - Database with transactions.
 * @param now - Current time.
 * @returns How many orders expired.
 */
export async function expireOverdueOrders(
  db: Transactional,
  now: Date
): Promise<number> {
  return db.transaction(async (tx) => {
    const overdue = await tx.query<{ id: number }>(
      'SELECT id FROM orders WHERE status_id = 1 AND expires_at < ? FOR UPDATE',
      [now]
    );
    if (overdue.length === 0) return 0;
    const ids = overdue.map((row) => row.id);
    await tx.query(
      'UPDATE products p JOIN (SELECT product_id, SUM(quantity) AS units FROM order_items WHERE order_id IN (?) GROUP BY product_id) r ON r.product_id = p.id SET p.reserved_stock = p.reserved_stock - r.units',
      [ids]
    );
    await tx.query(
      'UPDATE orders SET status_id = 3 WHERE id IN (?) AND status_id = 1',
      [ids]
    );
    return ids.length;
  });
}

/** Reserves every line or none (T1.2 I); throws to roll the transaction back. */
class InsufficientStock extends Error {}

async function reserveLines(
  tx: TxQuery,
  lines: readonly { sku: string; quantity: number }[]
): Promise<Map<string, number>> {
  // One transaction connection runs its queries in order, so the lines still reserve one after
  // another. Every line settles before the verdict, so the rollback never races a pending query.
  const reserved = await Promise.all(
    lines.map(async (line) => {
      const result = await tx.query(
        'UPDATE products SET reserved_stock = reserved_stock + ? WHERE sku = ? AND is_active = 1 AND stock - reserved_stock >= ?',
        [line.quantity, line.sku, line.quantity]
      );
      if (affected(result) !== 1) return null;
      const [row] = await tx.query<{ id: number }>(
        'SELECT id FROM products WHERE sku = ?',
        [line.sku]
      );
      return [line.sku, row.id] as const;
    })
  );
  if (reserved.includes(null)) throw new InsufficientStock();
  return new Map(reserved as (readonly [string, number])[]);
}

/** Cancels an order whose payment session could not be created, returning its stock. */
async function cancelOrder(db: Transactional, orderId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const result = await tx.query(
      'UPDATE orders SET status_id = 4 WHERE id = ? AND status_id = 1',
      [orderId]
    );
    if (affected(result) !== 1) return;
    await tx.query(
      'UPDATE products p JOIN order_items i ON i.product_id = p.id SET p.reserved_stock = p.reserved_stock - i.quantity WHERE i.order_id = ?',
      [orderId]
    );
  });
}

function methodOf(body: unknown): PaymentMethodCode | null {
  const method = (body as { method?: unknown } | null)?.method;
  return PAYMENT_METHOD_CODES.find((code) => code === method) ?? null;
}

type Refusal = Extract<CheckoutOutcome, { ok: false }>;

/** A request that passed T1.1, with the processor that will collect it. */
interface Admitted {
  request: CheckoutRequest;
  method: PaymentMethodCode;
  processorCode: ProcessorCode;
  processor: PaymentProcessorPort;
  secrets: CheckoutSecrets;
}

/** T1.1 in order K → A → C (plus a well-formed method, needed to know the processor). */
function admit(deps: CheckoutDeps, body: unknown): Refusal | Admitted {
  const method = methodOf(body);
  if (method === null) return refuse(400, 'INVALID_REQUEST') as Refusal;
  // K: closed before anything else is read.
  const processorCode = PROCESSOR_OF[method];
  const processor = deps.processors[processorCode];
  const secrets = deps.payments.checkout;
  if (processor === undefined || secrets === null) {
    return refuse(503, 'SERVICE_UNAVAILABLE') as Refusal;
  }
  const parsed = checkoutRequestSchema.safeParse(body);
  if (!parsed.success) {
    const buyerData = parsed.error.issues.some((issue) =>
      ['customer', 'address'].includes(String(issue.path[0]))
    );
    return refuse(
      400,
      buyerData ? 'INVALID_SHIPPING_ADDRESS' : 'INVALID_REQUEST'
    ) as Refusal;
  }
  if (!parsed.data.privacyConsent) {
    return refuse(400, 'PRIVACY_CONSENT_REQUIRED') as Refusal;
  }
  return { request: parsed.data, method, processorCode, processor, secrets };
}

type Quote = Extract<
  Awaited<ReturnType<typeof quoteCartToDestination>>,
  { ok: true }
>['quote'];

/** Cart quotable, then T1.2 D → P, re-quoted to the checkout address's state. */
async function price(
  deps: CheckoutDeps,
  request: CheckoutRequest,
  lang: 'es-MX' | 'en'
): Promise<Refusal | Quote> {
  const quoted = await quoteCartToDestination(
    deps.db,
    request.items,
    await deps.rate(),
    lang,
    {
      stateCode: request.address.stateCode,
      postalCode: request.address.postalCode,
    },
    deps.shipping
  );
  if (!quoted.ok) {
    return refuse(
      400,
      quoted.code === 'EMPTY_OR_UNAVAILABLE_CART'
        ? 'EMPTY_OR_UNAVAILABLE_CART'
        : 'INVALID_SHIPPING_ADDRESS'
    ) as Refusal;
  }
  const { shippingCode, totalMxnCents } = quoted.quote.summary;
  if (shippingCode !== 'STANDARD_RATE' && shippingCode !== 'FREE_SHIPPING') {
    return refuse(400, 'UNSERVICEABLE_DESTINATION') as Refusal;
  }
  if (totalMxnCents !== request.expectedTotalMxnCents) {
    return refuse(409, 'PRICE_CHANGED') as Refusal;
  }
  return quoted.quote;
}

/** What the order row needs besides the quote. */
interface NewOrder {
  orderNumber: string;
  accessToken: string;
  methodId: number;
  now: Date;
  expiresAt: Date;
}

/** T1.2 I and the order itself, in one transaction: every line reserved, or nothing kept. */
async function persist(
  deps: CheckoutDeps,
  admitted: Admitted,
  quote: Quote,
  order: NewOrder
): Promise<Refusal | number> {
  const { request, secrets } = admitted;
  const { customer, address } = request;
  const summary = quote.summary;
  const seal = (field: PiiField, value: string) =>
    encryptPii(secrets.piiKey, order.orderNumber, field, value);
  try {
    return await deps.db.transaction(async (tx) => {
      const productIds = await reserveLines(tx, request.items);
      const inserted = await tx.query(
        'INSERT INTO orders (order_number, status_id, payment_method_id, shipping_zone_id, items_base_mxn_cents, items_tax_mxn_cents, items_total_mxn_cents, shipping_base_mxn_cents, shipping_tax_mxn_cents, shipping_total_mxn_cents, total_mxn_cents, customer_name_enc, customer_email_enc, customer_phone_enc, shipping_address_enc, customer_email_hmac, access_token_hash, privacy_consent_at, expires_at, is_test) SELECT ?, 1, ?, z.id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM shipping_zones z WHERE z.code = ?',
        [
          order.orderNumber,
          order.methodId,
          summary.itemsBaseMxnCents,
          summary.itemsTaxMxnCents,
          summary.itemsTotalMxnCents,
          summary.shippingBaseMxnCents,
          summary.shippingTaxMxnCents,
          summary.shippingTotalMxnCents,
          summary.totalMxnCents,
          seal('customer_name', customer.name),
          seal('customer_email', customer.email),
          seal('customer_phone', customer.phone),
          seal('shipping_address', JSON.stringify(address)),
          emailHmac(secrets.emailPepper, customer.email),
          tokenHash(secrets.tokenPepper, order.accessToken),
          order.now,
          order.expiresAt,
          deps.payments.mode === 'sandbox' ? 1 : 0,
          address.stateCode,
        ]
      );
      const id = (inserted as unknown as { insertId: number }).insertId;
      // One multi-row insert: mysql2 expands `VALUES ?` from the nested array, escaping each value.
      await tx.query(
        'INSERT INTO order_items (order_id, product_id, sku, quantity, unit_price_mxn_cents, line_base_mxn_cents, line_tax_mxn_cents, line_total_mxn_cents) VALUES ?',
        [
          quote.items.map((item) => [
            id,
            productIds.get(item.sku),
            item.sku,
            item.quantity,
            item.unitPriceMxnCents,
            item.lineBaseMxnCents,
            item.lineTaxMxnCents,
            item.lineTotalMxnCents,
          ]),
        ]
      );
      return id;
    });
  } catch (error) {
    if (error instanceof InsufficientStock) {
      return refuse(409, 'INSUFFICIENT_STOCK') as Refusal;
    }
    throw error;
  }
}

/**
 * Runs one checkout: validation, quote, reservation, order and hosted session.
 *
 * @param deps - Database, rates, processors, configuration and clock.
 * @param body - The request body as received (validated here).
 * @param lang - Language of the return pages and product names.
 * @returns The session to redirect to, or the first refusal of the truth tables.
 */
export async function createCheckout(
  deps: CheckoutDeps,
  body: unknown,
  lang: 'es-MX' | 'en'
): Promise<CheckoutOutcome> {
  const admitted = admit(deps, body);
  if ('ok' in admitted) return admitted;
  const now = deps.now();
  await expireOverdueOrders(deps.db, now);
  const quote = await price(deps, admitted.request, lang);
  if ('ok' in quote) return quote;

  const [methodRow] = await deps.db.query<{ id: number; hold_minutes: number }>(
    'SELECT id, hold_minutes FROM payment_methods WHERE code = ? AND is_active = 1',
    [admitted.method]
  );
  if (methodRow === undefined) return refuse(503, 'SERVICE_UNAVAILABLE');
  const order: NewOrder = {
    orderNumber: newOrderNumber(now),
    accessToken: newAccessToken(),
    methodId: methodRow.id,
    now,
    expiresAt: new Date(
      now.getTime() + Number(methodRow.hold_minutes) * 60_000
    ),
  };
  const orderId = await persist(deps, admitted, quote, order);
  if (typeof orderId !== 'number') return orderId;

  const paths = CHECKOUT_RETURN_PATHS[lang];
  const webhook =
    admitted.processorCode === 'STRIPE' ? 'stripe' : 'mercadopago';
  const total = quote.summary.totalMxnCents;
  try {
    const session = await admitted.processor.createSession({
      orderNumber: order.orderNumber,
      method: admitted.method,
      totalMxnCents: total,
      description: `Yēkora · ${order.orderNumber}`,
      expiresAt: order.expiresAt,
      now,
      successUrl: `${deps.payments.siteUrl}${paths.success}`,
      cancelUrl: `${deps.payments.siteUrl}${paths.cancel}`,
      notificationUrl: `${deps.payments.apiUrl}/v1/webhooks/${webhook}`,
    });
    await deps.db.query(
      'UPDATE orders SET processor_reference = ? WHERE id = ?',
      [session.reference, orderId]
    );
    return {
      ok: true,
      session: {
        orderNumber: order.orderNumber,
        accessToken: order.accessToken,
        redirectUrl: session.redirectUrl,
        expiresAt: order.expiresAt.toISOString(),
        totalMxnCents: total,
      },
    };
  } catch {
    // The processor (or recording its reference) failed: give the stock back at once.
    await cancelOrder(deps.db, orderId);
    return refuse(503, 'SERVICE_UNAVAILABLE');
  }
}
