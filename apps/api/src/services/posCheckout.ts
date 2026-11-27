/**
 * The sale at the counter (FC 076 F2, K-79, T0.1, T0.3, T0.4, T1.1, T1.3, T2.1, T2.2). The same
 * stock as the web: the products of the sale are locked in the order of their ids, a unit reserved
 * online is never sold, and `stock` goes down in the same transaction that records the order,
 * without touching `reserved_stock`. The order is born delivered and paid, with the server's
 * prices and VAT, and the counter's buyer data sealed as any other order's.
 *
 * Cash records what was given and the change; the Banorte terminal records only the
 * authorization, the last four digits, the brand and the voucher folio. A text that looks like a
 * card number is refused, so none can ever be stored.
 *
 * @module
 */
import { randomBytes } from 'node:crypto';
import type { z } from 'zod';
import type {
  posProductsSchema,
  posSaleSchema,
  posSaleResultSchema,
} from '../../../../lib/account/posTypes';
import type { CheckoutSecrets } from '../config';
import { splitVat } from '../lib/money';
import { recordAudit } from './audit';
import {
  emailHmac,
  encryptPii,
  newOrderNumber,
  type PiiField,
  tokenHash,
} from './checkoutCrypto';
import type { TxQuery } from './db';
import { enqueueMail } from './outbox';
import {
  decidePayment,
  decideSaleStock,
  type PaymentCode,
  type SaleStockCode,
} from './posGates';
import type { PosActor } from './posShifts';

/** How a sale is refused: a row of T1.1 or T1.3, or a product the counter does not have. */
type SaleRefusal =
  | Exclude<SaleStockCode, 'SALE_PERMITTED'>
  | Exclude<PaymentCode, 'PAYMENT_VALID_ACCEPTED'>
  | 'POS_PRODUCT_UNKNOWN';

type Sale = z.infer<typeof posSaleSchema>;
type Result = z.infer<typeof posSaleResultSchema>;

/** The payment methods of migration 020. */
const METHOD_IDS = { POS_CASH: 5, POS_CARD_MANUAL: 6 } as const;
/** The seeded zone a counter sale carries: nothing is shipped. */
const COUNTER_ZONE = 1;
const HOLD_MS = 60 * 60 * 1000;
/** What a sale without a customer e-mail seals. */
const COUNTER_EMAIL = 'pos@mostrador.local';
/** A run of digits as long as a card number: never accepted in a voucher field. */
const CARD_NUMBER = /\d(?:[ -]?\d){12,18}/;
const AUTH_CODE = /^[A-Za-z0-9]{1,32}$/;
const LAST_FOUR = /^\d{4}$/;

interface ProductRow {
  id: number;
  sku: string;
  price_mxn_cents: number | string;
  stock: number | string;
  reserved_stock: number | string;
  allows_return: number;
}

interface Line {
  productId: number;
  sku: string;
  quantity: number;
  unit: number;
  total: number;
  base: number;
  tax: number;
  allowsReturn: number;
}

/**
 * The products the counter may sell, with what is left after the web's reservations.
 *
 * @param db - Database port.
 * @param search - Part of a SKU or a name, or undefined for all.
 * @returns Up to 100 active products by SKU.
 */
export async function posProducts(
  db: TxQuery,
  search: string | undefined
): Promise<z.infer<typeof posProductsSchema>> {
  const escaped = (search ?? '').replaceAll(/[\\%_]/g, String.raw`\$&`);
  const like = `%${escaped}%`;
  const rows = await db.query<{
    sku: string;
    name_es: string;
    name_en: string;
    price_mxn_cents: number | string;
    available: number | string;
  }>(
    'SELECT sku, name_es, name_en, price_mxn_cents, stock - reserved_stock AS available FROM products WHERE is_active = 1 AND (sku LIKE ? OR name_es LIKE ? OR name_en LIKE ?) ORDER BY sku LIMIT 100',
    [like, like, like]
  );
  return {
    items: rows.map((row) => ({
      sku: row.sku,
      nameEs: row.name_es,
      nameEn: row.name_en,
      priceMxnCents: Number(row.price_mxn_cents),
      available: Number(row.available),
    })),
  };
}

/** The lines of a sale at the server's prices, or the first reason they cannot be sold. */
async function priced(
  tx: TxQuery,
  sale: Sale,
  shiftOpen: boolean
): Promise<Line[] | SaleRefusal> {
  const skus = sale.items.map((item) => item.sku);
  const rows = await tx.query<ProductRow>(
    'SELECT id, sku, price_mxn_cents, stock, reserved_stock, allows_return FROM products WHERE sku IN (?) AND is_active = 1 ORDER BY id FOR UPDATE',
    [skus]
  );
  const found = new Map(rows.map((row) => [row.sku, row]));
  const lines: Line[] = [];
  for (const item of sale.items) {
    const row = found.get(item.sku);
    if (row === undefined) return 'POS_PRODUCT_UNKNOWN';
    const stock = Number(row.stock);
    const decision = decideSaleStock({
      stock: stock >= item.quantity,
      unreserved: stock - Number(row.reserved_stock) >= item.quantity,
      shiftOpen,
    });
    if (decision !== 'SALE_PERMITTED') return decision;
    const unit = Number(row.price_mxn_cents);
    const total = unit * item.quantity;
    lines.push({
      productId: Number(row.id),
      sku: row.sku,
      quantity: item.quantity,
      unit,
      total,
      ...splitVat(total),
      allowsReturn: Number(row.allows_return),
    });
  }
  return lines;
}

/** T1.3 over what was sent and the total the server computed. */
function checkPayment(payment: Sale['payment'], total: number): PaymentCode {
  const cash = payment.method === 'POS_CASH';
  const card = payment.method === 'POS_CARD_MANUAL';
  // The voucher fields, each read once; an absent one is empty and fails its check.
  const [auth = '', lastFour = '', brand = '', folio = ''] = [
    payment.terminalAuthCode,
    payment.cardLastFour,
    payment.cardBrand,
    payment.voucherFolio,
  ];
  const voucher =
    AUTH_CODE.test(auth) &&
    LAST_FOUR.test(lastFour) &&
    folio !== '' &&
    brand !== '' &&
    ![auth, brand, folio].some((text) => CARD_NUMBER.test(text));
  return decidePayment({
    method: cash || card,
    tendered: !cash || (payment.tenderedMxnCents ?? -1) >= total,
    amount: !card || payment.confirmedAmountMxnCents === total,
    voucher: !card || voucher,
  });
}

/** Records the order of the sale, delivered at once, and returns its id and number. */
async function insertOrder(
  tx: TxQuery,
  input: {
    sale: Sale;
    lines: Line[];
    shiftId: number;
    cashier: string;
    secrets: CheckoutSecrets;
    now: Date;
  }
): Promise<{ id: number; orderNumber: string; total: number; change: number }> {
  const { sale, lines, secrets, now } = input;
  const orderNumber = newOrderNumber(now);
  const sum = (pick: (line: Line) => number) =>
    lines.reduce((total, line) => total + pick(line), 0);
  const total = sum((line) => line.total);
  const cash = sale.payment.method === 'POS_CASH';
  const change = cash ? (sale.payment.tenderedMxnCents as number) - total : 0;
  const email = sale.customerEmail ?? COUNTER_EMAIL;
  const seal = (field: PiiField, value: string) =>
    encryptPii(secrets.piiKey, orderNumber, field, value);
  const inserted = await tx.query(
    "INSERT INTO orders (order_number, status_id, payment_method_id, payment_resource_id, shipping_zone_id, items_base_mxn_cents, items_tax_mxn_cents, items_total_mxn_cents, shipping_base_mxn_cents, shipping_tax_mxn_cents, shipping_total_mxn_cents, total_mxn_cents, customer_name_enc, customer_email_enc, customer_phone_enc, shipping_address_enc, customer_email_hmac, access_token_hash, privacy_consent_at, expires_at, paid_at, shipped_at, delivered_at, is_test, locale, channel, pos_shift_id, pos_cashier_id, pos_tendered_mxn_cents, pos_change_mxn_cents, pos_terminal_auth_code, pos_terminal_last_four, pos_terminal_brand, pos_terminal_voucher_folio) VALUES (?, 9, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'es-MX', 'pos', ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      orderNumber,
      METHOD_IDS[sale.payment.method as keyof typeof METHOD_IDS],
      `pos:${orderNumber}`,
      COUNTER_ZONE,
      sum((line) => line.base),
      sum((line) => line.tax),
      total,
      total,
      seal('customer_name', 'Cliente Mostrador'),
      seal('customer_email', email),
      seal('customer_phone', '0000000000'),
      seal('shipping_address', JSON.stringify({ counter: 'Mostrador Yekora' })),
      emailHmac(secrets.emailPepper, email),
      tokenHash(secrets.tokenPepper, randomBytes(32).toString('base64url')),
      now,
      new Date(now.getTime() + HOLD_MS),
      now,
      now,
      now,
      input.shiftId,
      input.cashier,
      cash ? sale.payment.tenderedMxnCents : null,
      cash ? change : null,
      cash ? null : sale.payment.terminalAuthCode,
      cash ? null : sale.payment.cardLastFour,
      cash ? null : sale.payment.cardBrand,
      cash ? null : sale.payment.voucherFolio,
    ]
  );
  const id = (inserted as unknown as { insertId: number }).insertId;
  return { id, orderNumber, total, change };
}

/**
 * Sells at the counter.
 *
 * @param tx - Transaction of the request.
 * @param sale - The lines, the payment and, if the buyer wants it, the e-mail of the receipt.
 * @param context - The cashier, the checkout secrets and the clock.
 * @returns The sale, or the row of T1.1 or T1.3 that refused it.
 */
export async function sellAtCounter(
  tx: TxQuery,
  sale: Sale,
  context: { actor: PosActor; secrets: CheckoutSecrets; now: Date }
): Promise<Result | SaleRefusal> {
  const { actor, secrets, now } = context;
  const [shift] = await tx.query<{ id: number }>(
    "SELECT id FROM pos_shifts WHERE status = 'OPEN' FOR UPDATE"
  );
  const lines = await priced(tx, sale, shift !== undefined);
  if (typeof lines === 'string') return lines;
  const total = lines.reduce((n, line) => n + line.total, 0);
  const payment = checkPayment(sale.payment, total);
  if (payment !== 'PAYMENT_VALID_ACCEPTED') return payment;
  const order = await insertOrder(tx, {
    sale,
    lines,
    shiftId: Number(shift.id),
    cashier: actor.userId,
    secrets,
    now,
  });
  await tx.query(
    'INSERT INTO order_items (order_id, product_id, sku, quantity, unit_price_mxn_cents, line_base_mxn_cents, line_tax_mxn_cents, line_total_mxn_cents, allows_return) VALUES ?',
    [
      lines.map((line) => [
        order.id,
        line.productId,
        line.sku,
        line.quantity,
        line.unit,
        line.base,
        line.tax,
        line.total,
        line.allowsReturn,
      ]),
    ]
  );
  await Promise.all(
    lines.map((line) =>
      tx.query('UPDATE products SET stock = stock - ? WHERE id = ?', [
        line.quantity,
        line.productId,
      ])
    )
  );
  await recordAudit(tx, {
    userId: actor.userId,
    action: 'POS_SALE',
    entityType: 'orders',
    entityId: order.orderNumber,
    before: null,
    after: { method: sale.payment.method, totalMxnCents: order.total },
    ip: actor.ip,
  });
  if (sale.customerEmail !== undefined) {
    await enqueueMail(tx, { type: 'POS_RECEIPT_EMAIL', orderId: order.id });
  }
  return {
    orderNumber: order.orderNumber,
    method: sale.payment.method as Result['method'],
    totalMxnCents: order.total,
    changeMxnCents: order.change,
  };
}
