/**
 * Asking for the invoice of an order (FC 077 F2).
 *
 * - An order is judged in a fixed order (T1.1): it is paid and something of it is left to invoice;
 *   the date is inside the fiscal window (30 days from the payment, or 7 from the latest refusal or
 *   cancellation); and no request of it is PENDING or COMPLETED. The order row is locked, so two
 *   requests at once cannot both pass, and `uq_invoice_requests_active_order` backs it.
 * - What can be invoiced is what the order charged minus what its returns already pay back
 *   (REFUNDED or on their way). A partial refund made only in the processor's panel is not in the
 *   database and is not subtracted: a declared limit of the contract.
 * - The legal name, the postal code and the e-mail are stored only as ciphertext bound to the
 *   order (T2.4). Every statement is static SQL with `?` placeholders (A03).
 *
 * @module
 */
import type {
  InvoiceQueue,
  InvoiceRequestInput,
} from '../../../../lib/account/invoiceTypes';
import { recordAudit } from './audit';
import { decryptPii, emailHmac, encryptPii } from './checkoutCrypto';
import type { Db, TxQuery } from './db';

/** The statuses of an order that was paid and not cancelled or refunded: 2, 7, 8 and 9. */
const INVOICEABLE_STATUSES: ReadonlySet<number> = new Set([2, 7, 8, 9]);
const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_AFTER_PAYMENT_MS = 30 * DAY_MS;
const WINDOW_AFTER_REFUSAL_MS = 7 * DAY_MS;
/** Requests one page of the queue holds. */
const PAGE_SIZE = 50;

/** Why a request for an invoice is refused. */
type InvoiceRefusal =
  | 'ORDER_NOT_FOUND'
  | 'ORDER_BELONGS_TO_ACCOUNT_REJECT'
  | 'ORDER_NOT_ELIGIBLE_REJECT'
  | 'FISCAL_DEADLINE_EXPIRED_REJECT'
  | 'INVOICE_ALREADY_EXISTS_REJECT';

/** Status and title of each refusal. */
export const INVOICE_REFUSALS: Readonly<
  Record<InvoiceRefusal, readonly [number, string]>
> = {
  ORDER_NOT_FOUND: [404, 'Not found'],
  ORDER_BELONGS_TO_ACCOUNT_REJECT: [
    409,
    'The buyer has an account and asks from it',
  ],
  ORDER_NOT_ELIGIBLE_REJECT: [409, 'The order cannot be invoiced'],
  FISCAL_DEADLINE_EXPIRED_REJECT: [400, 'The time to ask for it has passed'],
  INVOICE_ALREADY_EXISTS_REJECT: [409, 'The order already has a request'],
};

/** The keys of personal data the requests are sealed and looked up with. */
export interface InvoiceSecrets {
  /** CHECKOUT_PII_KEY. */
  piiKey: Buffer;
  /** CUSTOMER_EMAIL_HMAC_PEPPER. */
  emailPepper: string;
}

/** What happened before to the requests of an order. */
interface History {
  active: number | string;
  rejected_at: Date | null;
  cancelled_at: Date | null;
}

/** Whether `now` is still within `length` of `since`. */
const within = (since: Date | null, length: number, now: Date) =>
  since !== null && now.getTime() - since.getTime() <= length;

/**
 * What can still be invoiced of an order, MXN cents: what it charged minus what its returns pay
 * back.
 *
 * @param tx - Transaction, or the database.
 * @param orderId - The order.
 * @param totalCents - What it charged.
 * @returns The amount an invoice of it may carry.
 */
async function invoicableCents(
  tx: TxQuery,
  orderId: number,
  totalCents: number
): Promise<number> {
  const [row] = await tx.query<{ n: number | string }>(
    "SELECT COALESCE(SUM(refund_mxn_cents), 0) AS n FROM order_returns WHERE order_id = ? AND status IN ('REFUNDING', 'REFUNDED')",
    [orderId]
  );
  return totalCents - Number(row.n);
}

/**
 * Files the request of an invoice for an order.
 *
 * @param tx - Transaction of the request.
 * @param input - The order number; the buyer who asks from their account (`ownerId`, or null when
 *   the staff asks for an order with no account: a guest or a counter sale); the fiscal data the
 *   gate T1.2 accepted with where to send the invoice; and the clock.
 * @param context - The keys, and who to name in the audit trail.
 * @returns The request filed, or why not (T1.1).
 */
export async function requestInvoice(
  tx: TxQuery,
  input: {
    orderNumber: string;
    ownerId: string | null;
    data: InvoiceRequestInput;
    now: Date;
  },
  context: { secrets: InvoiceSecrets; userId: string; ip: string }
): Promise<{ id: number; status: 'PENDING' } | InvoiceRefusal> {
  const { orderNumber, ownerId, data, now } = input;
  const [order] = await tx.query<{
    id: number;
    user_id: string | null;
    status_id: number;
    total_mxn_cents: number;
    paid_at: Date | null;
  }>(
    'SELECT id, user_id, status_id, total_mxn_cents, paid_at FROM orders WHERE order_number = ? FOR UPDATE',
    [orderNumber]
  );
  // Someone else's order reads as one that does not exist (A01).
  if (order === undefined || (ownerId !== null && order.user_id !== ownerId)) {
    return 'ORDER_NOT_FOUND';
  }
  if (ownerId === null && order.user_id !== null) {
    return 'ORDER_BELONGS_TO_ACCOUNT_REJECT';
  }
  if (
    !INVOICEABLE_STATUSES.has(order.status_id) ||
    (await invoicableCents(tx, order.id, order.total_mxn_cents)) <= 0
  ) {
    return 'ORDER_NOT_ELIGIBLE_REJECT';
  }
  const [history] = await tx.query<History>(
    "SELECT COALESCE(SUM(status IN ('PENDING', 'COMPLETED')), 0) AS active, MAX(rejected_at) AS rejected_at, MAX(cancelled_at) AS cancelled_at FROM invoice_requests WHERE order_id = ?",
    [order.id]
  );
  const inWindow =
    within(order.paid_at, WINDOW_AFTER_PAYMENT_MS, now) ||
    within(history.rejected_at, WINDOW_AFTER_REFUSAL_MS, now) ||
    within(history.cancelled_at, WINDOW_AFTER_REFUSAL_MS, now);
  if (!inWindow) return 'FISCAL_DEADLINE_EXPIRED_REJECT';
  if (Number(history.active) > 0) return 'INVOICE_ALREADY_EXISTS_REJECT';

  const { piiKey, emailPepper } = context.secrets;
  const email = data.emailForInvoice;
  const inserted = await tx.query(
    'INSERT INTO invoice_requests (order_id, user_id, rfc, legal_name_enc, tax_system, postal_code_enc, cfdi_use, email_for_invoice_enc, email_for_invoice_hmac) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      order.id,
      order.user_id,
      data.rfc,
      encryptPii(piiKey, orderNumber, 'fiscal_legal_name', data.legalName),
      data.taxSystem,
      encryptPii(piiKey, orderNumber, 'fiscal_postal_code', data.postalCode),
      data.cfdiUse,
      encryptPii(piiKey, orderNumber, 'invoice_email', email),
      emailHmac(emailPepper, email).toString('hex'),
    ]
  );
  const { insertId } = inserted as unknown as { insertId: number };
  await recordAudit(tx, {
    userId: context.userId,
    action: 'INVOICE_REQUESTED',
    entityType: 'invoice_requests',
    entityId: String(insertId),
    before: null,
    after: { orderNumber },
    ip: context.ip,
  });
  return { id: Number(insertId), status: 'PENDING' };
}

/**
 * Where the latest request of one of the buyer's orders stands.
 *
 * @param db - Database port.
 * @param orderNumber - The order.
 * @param ownerId - The buyer; someone else's order is not found.
 * @returns Its status and, when refused or cancelled, why; or null when the order is not theirs.
 */
export async function orderInvoiceState(
  db: Db,
  orderNumber: string,
  ownerId: string
) {
  const [row] = await db.query<{
    status: string | null;
    rejection_reason: string | null;
    cancellation_reason: string | null;
  }>(
    'SELECT r.status, r.rejection_reason, r.cancellation_reason FROM orders o LEFT JOIN invoice_requests r ON r.order_id = o.id WHERE o.order_number = ? AND o.user_id = ? ORDER BY r.id DESC LIMIT 1',
    [orderNumber, ownerId]
  );
  if (row === undefined) return null;
  return {
    status: row.status,
    reason: row.cancellation_reason ?? row.rejection_reason,
  };
}

/** One row of the queue as it is read. */
interface QueueRow {
  id: number;
  order_number: string;
  channel: string;
  total_mxn_cents: number;
  returned: number | string;
  status: InvoiceQueue['items'][number]['status'];
  rfc: string;
  legal_name_enc: Buffer;
  tax_system: string;
  postal_code_enc: Buffer;
  cfdi_use: string;
  email_for_invoice_enc: Buffer;
  rejection_reason: string | null;
  cancellation_reason: string | null;
  requested_at: Date;
}

/**
 * One page of the queue of requests, newest first, opened for the staff.
 *
 * @param db - Database port.
 * @param piiKey - CHECKOUT_PII_KEY.
 * @param filter - The status and the order number or RFC to look for, and the page.
 * @returns The page and how many requests match.
 * @throws When a stored value does not authenticate.
 */
export async function listInvoiceRequests(
  db: Db,
  piiKey: Buffer,
  filter: { status?: string; search?: string; page: number }
): Promise<InvoiceQueue> {
  const status = filter.status ?? null;
  const search = filter.search ?? null;
  const [rows, [count]] = await Promise.all([
    db.query<QueueRow>(
      "SELECT r.id, o.order_number, o.channel, o.total_mxn_cents, (SELECT COALESCE(SUM(x.refund_mxn_cents), 0) FROM order_returns x WHERE x.order_id = o.id AND x.status IN ('REFUNDING', 'REFUNDED')) AS returned, r.status, r.rfc, r.legal_name_enc, r.tax_system, r.postal_code_enc, r.cfdi_use, r.email_for_invoice_enc, r.rejection_reason, r.cancellation_reason, r.requested_at FROM invoice_requests r JOIN orders o ON o.id = r.order_id WHERE (? IS NULL OR r.status = ?) AND (? IS NULL OR o.order_number = ? OR r.rfc = ?) ORDER BY r.requested_at DESC, r.id DESC LIMIT ? OFFSET ?",
      [
        status,
        status,
        search,
        search,
        search,
        PAGE_SIZE,
        (filter.page - 1) * PAGE_SIZE,
      ]
    ),
    db.query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM invoice_requests r JOIN orders o ON o.id = r.order_id WHERE (? IS NULL OR r.status = ?) AND (? IS NULL OR o.order_number = ? OR r.rfc = ?)',
      [status, status, search, search, search]
    ),
  ]);
  return {
    items: rows.map((row) => ({
      id: row.id,
      orderNumber: row.order_number,
      channel: row.channel,
      totalMxnCents: row.total_mxn_cents,
      invoicableMxnCents: row.total_mxn_cents - Number(row.returned),
      status: row.status,
      rfc: row.rfc,
      legalName: decryptPii(
        piiKey,
        row.order_number,
        'fiscal_legal_name',
        row.legal_name_enc
      ),
      taxSystem: row.tax_system,
      postalCode: decryptPii(
        piiKey,
        row.order_number,
        'fiscal_postal_code',
        row.postal_code_enc
      ),
      cfdiUse: row.cfdi_use,
      email: decryptPii(
        piiKey,
        row.order_number,
        'invoice_email',
        row.email_for_invoice_enc
      ),
      reason: row.cancellation_reason ?? row.rejection_reason,
      requestedAt: row.requested_at.toISOString(),
    })),
    total: Number(count.n),
    page: filter.page,
    pageSize: PAGE_SIZE,
  };
}
