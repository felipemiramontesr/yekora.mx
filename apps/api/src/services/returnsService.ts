/**
 * Returns and refunds (FC 071, K-80): the buyer asks, one operator prepares the refund, another
 * confirms it and the money goes back through the processor that took it.
 *
 * - {@link requestReturn}: the buyer's request, every line through the eligibility gate (T1.1).
 * - {@link prepareReturn}: an operator with `returns:prepare` sets the amount and whether the units
 *   go back to the shelf.
 * - {@link confirmReturn}: an operator with `returns:confirm` who is not the preparer (T1.2, T2.1)
 *   executes it. The order is always intent → call → close (T2.4): the first transaction records
 *   that the refund is being made, the processor is asked once with an idempotency key derived from
 *   the request, and the second transaction closes it. If the process dies in between, the request
 *   stays REFUNDING and confirming again finds the same refund at the processor.
 * - {@link isReturnRefund}: tells the webhook of FC 069 that a refund at the processor is ours.
 *
 * Nothing here keeps personal data: the audit entries carry ids, amounts and codes.
 *
 * @module
 */
import type {
  ReturnRequest,
  ReturnView,
} from '../../../../lib/account/returnTypes';
import { problem } from '../lib/problem';
import { recordAudit } from './audit';
import type { ProcessorCode } from './checkout';
import type { Db, Transactional, TxQuery } from './db';
import { enqueueMail } from './outbox';
import {
  PaymentProcessorError,
  type PaymentProcessorPort,
} from './paymentPort';
import {
  type ConfirmationCode,
  decideConfirmation,
  decideReturnLine,
  type EligibilityCode,
  withinReturnWindow,
} from './returnsEligibility';
import { drawerCash, writeMovement } from './posShifts';

/** Why a request changed nothing: the rows of both gates and the cases of the routes. */
export type ReturnRefusal =
  | Exclude<EligibilityCode, 'RETURN_ELIGIBLE_OK'>
  | Exclude<ConfirmationCode, 'REFUND_CONFIRMED_EXECUTE'>
  | 'ORDER_NOT_FOUND'
  | 'RETURN_PAYLOAD_INVALID'
  | 'RETURN_NOT_FOUND'
  | 'RETURN_STATUS_CONFLICT'
  | 'MANUAL_REFERENCE_REQUIRED'
  | 'REFUND_PROCESSOR_UNAVAILABLE'
  | 'REFUND_PROCESSOR_ERROR'
  | 'REFUND_METHOD_REQUIRED'
  | 'POS_SHIFT_CLOSED_REJECT'
  | 'INSUFFICIENT_DRAWER_CASH_REJECT';

/** Status and title of each refusal; the route answers with them and the code as the detail. */
export const RETURN_REFUSALS: Readonly<
  Record<ReturnRefusal, readonly [number, string]>
> = {
  DATA_DOMAIN_FORBIDDEN: [403, 'This order is not yours'],
  ORDER_NOT_FOUND: [404, 'Not found'],
  RETURN_NOT_FOUND: [404, 'Not found'],
  ORDER_NOT_DELIVERED_REJECT: [409, 'The order has not been delivered'],
  WINDOW_EXPIRED_REJECT: [409, 'The window of 60 days to return is over'],
  PRODUCT_NON_RETURNABLE_REJECT: [
    409,
    'A product of the request cannot be returned',
  ],
  INVALID_QUANTITY_REJECT: [400, 'The units asked cannot be returned'],
  RETURN_PAYLOAD_INVALID: [
    400,
    'The request names a line twice or one the order lacks',
  ],
  RETURN_STATUS_CONFLICT: [409, 'The request is not in a stage that allows it'],
  RETURN_NOT_PREPARED_REJECT: [409, 'The refund has not been prepared'],
  UNAUTHORIZED_CONFIRMER_REJECT: [403, 'You cannot confirm refunds'],
  DUAL_CONTROL_VIOLATION_REJECT: [
    403,
    'Another person has to confirm what you prepared',
  ],
  INVALID_REFUND_AMOUNT_REJECT: [409, 'The amount exceeds what the order paid'],
  REFUND_METHOD_REQUIRED: [
    400,
    'A counter refund is paid back in cash or on the terminal',
  ],
  POS_SHIFT_CLOSED_REJECT: [409, 'Open a shift before giving cash back'],
  INSUFFICIENT_DRAWER_CASH_REJECT: [400, 'The drawer does not hold it'],
  MANUAL_REFERENCE_REQUIRED: [
    400,
    'The reference of the refund made by hand is required',
  ],
  REFUND_PROCESSOR_UNAVAILABLE: [503, 'The processor cannot refund now'],
  REFUND_PROCESSOR_ERROR: [502, 'The processor did not accept the refund'],
};

/** Who acts, for the audit entry. */
interface Actor {
  /** The operator's user id. */
  userId: string;
  /** Client address. */
  ip: string | null;
}

/** The statuses of `order_statuses` a refund moves between. */
const REFUNDED_ORDER = 5;
const PAID_STATUSES: ReadonlySet<number> = new Set([2, 7, 8, 9]);

const iso = (date: Date | null) =>
  date === null ? null : new Date(date).toISOString();

/** A request as MariaDB returns it with its order number. */
interface ReturnRow {
  id: number;
  order_number: string;
  status: ReturnView['status'];
  reason: ReturnView['reason'];
  comment: string | null;
  refund_mxn_cents: number | null;
  restock: number | null;
  created_at: Date;
  prepared_at: Date | null;
  confirmed_at: Date | null;
}

/** The requests of `rows` with their lines, as the contract names them. */
async function withLines(
  db: TxQuery,
  rows: readonly ReturnRow[]
): Promise<ReturnView[]> {
  if (rows.length === 0) return [];
  const lines = await db.query<{
    return_id: number;
    sku: string;
    quantity: number;
  }>(
    'SELECT ri.return_id, i.sku, ri.quantity FROM order_return_items ri JOIN order_items i ON i.id = ri.order_item_id WHERE ri.return_id IN (?) ORDER BY ri.id',
    [rows.map((row) => row.id)]
  );
  return rows.map((row) => ({
    id: row.id,
    orderNumber: row.order_number,
    status: row.status,
    reason: row.reason,
    comment: row.comment,
    items: lines
      .filter((line) => line.return_id === row.id)
      .map((line) => ({ sku: line.sku, quantity: Number(line.quantity) })),
    refundMxnCents:
      row.refund_mxn_cents === null ? null : Number(row.refund_mxn_cents),
    restock: row.restock === null ? null : Number(row.restock) === 1,
    createdAt: iso(row.created_at) as string,
    preparedAt: iso(row.prepared_at),
    confirmedAt: iso(row.confirmed_at),
  }));
}

/** One request by id, as the contract names it. */
async function viewOf(db: TxQuery, id: number): Promise<ReturnView> {
  const rows = await db.query<ReturnRow>(
    'SELECT r.id, o.order_number, r.status, r.reason, r.comment, r.refund_mxn_cents, r.restock, r.created_at, r.prepared_at, r.confirmed_at FROM order_returns r JOIN orders o ON o.id = r.order_id WHERE r.id = ?',
    [id]
  );
  return (await withLines(db, rows))[0];
}

/**
 * The buyer asks for a return. Every line goes through T1.1 in the order of the request and the
 * first one that fails refuses the whole request, so nothing is half accepted.
 *
 * @param tx - The caller's transaction.
 * @param input - Order number, the buyer's account, the lines, the reason and the clock.
 * @param actor - Who acts, for the audit entry.
 * @returns The request created, or why nothing was created.
 */
export async function requestReturn(
  tx: TxQuery,
  input: {
    orderNumber: string;
    userId: string;
    request: ReturnRequest;
    now: Date;
    /** True when the staff of the counter asks for a counter sale (FC 076 F3). */
    counter?: boolean;
  },
  actor: Actor
): Promise<ReturnView | ReturnRefusal> {
  const [order] = await tx.query<{
    id: number;
    user_id: string | null;
    status_id: number;
    delivered_at: Date | null;
    channel: string;
  }>(
    'SELECT id, user_id, status_id, delivered_at, channel FROM orders WHERE order_number = ? FOR UPDATE',
    [input.orderNumber]
  );
  if (order === undefined) return 'ORDER_NOT_FOUND';
  // The counter's route reaches only counter sales; the buyer's route only the buyer's own.
  if (input.counter === true && order.channel !== 'pos')
    return 'ORDER_NOT_FOUND';
  const skus = input.request.items.map((line) => line.sku);
  if (new Set(skus).size !== skus.length) return 'RETURN_PAYLOAD_INVALID';
  const lines = await tx.query<{
    id: number;
    sku: string;
    quantity: number;
    allows_return: number;
    returned: number | string;
  }>(
    'SELECT i.id, i.sku, i.quantity, i.allows_return, COALESCE(SUM(ri.quantity), 0) AS returned FROM order_items i LEFT JOIN order_return_items ri ON ri.order_item_id = i.id WHERE i.order_id = ? GROUP BY i.id, i.sku, i.quantity, i.allows_return',
    [order.id]
  );
  const owner = input.counter === true || order.user_id === input.userId;
  const delivered = Number(order.status_id) === 9;
  const withinWindow = withinReturnWindow(order.delivered_at, input.now);
  const chosen: { id: number; quantity: number }[] = [];
  for (const asked of input.request.items) {
    const line = lines.find((candidate) => candidate.sku === asked.sku);
    if (line === undefined) {
      return owner ? 'RETURN_PAYLOAD_INVALID' : 'DATA_DOMAIN_FORBIDDEN';
    }
    const verdict = decideReturnLine({
      owner,
      delivered,
      withinWindow,
      allowsReturn: Number(line.allows_return) === 1,
      validQuantity:
        asked.quantity <= Number(line.quantity) - Number(line.returned),
    });
    if (verdict !== 'RETURN_ELIGIBLE_OK') return verdict;
    chosen.push({ id: line.id, quantity: asked.quantity });
  }
  const comment = input.request.comment ?? null;
  const inserted = await tx.query(
    'INSERT INTO order_returns (order_id, reason, comment, requested_by) VALUES (?, ?, ?, ?)',
    [
      order.id,
      input.request.reason,
      comment === '' ? null : comment,
      input.userId,
    ]
  );
  const insertId = (inserted as unknown as { insertId: number }).insertId;
  await tx.query(
    'INSERT INTO order_return_items (return_id, order_item_id, quantity) VALUES ?',
    [chosen.map((line) => [insertId, line.id, line.quantity])]
  );
  await recordAudit(tx, {
    userId: actor.userId,
    action: 'RETURN_REQUESTED',
    entityType: 'order_returns',
    entityId: String(insertId),
    before: null,
    after: { order: input.orderNumber, lines: chosen.length },
    ip: actor.ip,
  });
  return viewOf(tx, insertId);
}

/**
 * The board: every request, newest first, optionally of one stage.
 *
 * @param db - Database port.
 * @param status - Stage filter, or null for all.
 * @returns The requests (up to 200) and the total of the filter.
 */
export async function listReturns(
  db: Db,
  status: ReturnView['status'] | null
): Promise<{ items: ReturnView[]; total: number }> {
  const [rows, [count]] = await Promise.all([
    db.query<ReturnRow>(
      'SELECT r.id, o.order_number, r.status, r.reason, r.comment, r.refund_mxn_cents, r.restock, r.created_at, r.prepared_at, r.confirmed_at FROM order_returns r JOIN orders o ON o.id = r.order_id WHERE (? IS NULL OR r.status = ?) ORDER BY r.created_at DESC, r.id DESC LIMIT 200',
      [status, status]
    ),
    db.query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM order_returns WHERE (? IS NULL OR status = ?)',
      [status, status]
    ),
  ]);
  return { items: await withLines(db, rows), total: Number(count.n) };
}

/** What the orders already committed to refund, MXN cents, apart from the request `id`. */
async function committedCents(
  tx: TxQuery,
  orderId: number,
  id: number
): Promise<number> {
  const [row] = await tx.query<{ n: number | string }>(
    "SELECT COALESCE(SUM(refund_mxn_cents), 0) AS n FROM order_returns WHERE order_id = ? AND id <> ? AND status IN ('REFUNDING', 'REFUNDED')",
    [orderId, id]
  );
  return Number(row.n);
}

/**
 * What the processor refunded that no request of ours accounts for: its total refunded minus the
 * requests already REFUNDED here (T2.2, a refund made in the processor's dashboard counts).
 */
async function outsideRefundedCents(
  tx: TxQuery,
  orderId: number,
  processorRefundedCents: number
): Promise<number> {
  const [row] = await tx.query<{ n: number | string }>(
    "SELECT COALESCE(SUM(refund_mxn_cents), 0) AS n FROM order_returns WHERE order_id = ? AND status = 'REFUNDED'",
    [orderId]
  );
  return Math.max(0, processorRefundedCents - Number(row.n));
}

/**
 * Reads from the processor how much of the payment of a request's order is already refunded,
 * whoever refunded it, so the cap of T2.2 counts it. A processor that cannot say, or an order
 * with no payment to read, counts as nothing; a processor that fails to answer refuses, since the
 * cap could not be checked.
 *
 * @param deps - Database and the configured processors.
 * @param id - `order_returns.id`.
 * @returns MXN cents refunded so far, or `REFUND_PROCESSOR_ERROR`.
 */
export async function readProcessorRefunded(
  deps: {
    db: Db;
    processors: Partial<Record<ProcessorCode, PaymentProcessorPort>>;
  },
  id: number
): Promise<number | 'REFUND_PROCESSOR_ERROR'> {
  const [row] = await deps.db.query<{
    processor_code: OrderProcessor;
    payment_resource_id: string | null;
  }>(
    'SELECT p.code AS processor_code, o.payment_resource_id FROM order_returns r JOIN orders o ON o.id = r.order_id JOIN payment_methods m ON m.id = o.payment_method_id JOIN payment_processors p ON p.id = m.processor_id WHERE r.id = ?',
    [id]
  );
  const processor =
    row?.processor_code === 'STRIPE' ? deps.processors.STRIPE : undefined;
  if (
    processor?.fetchRefundedTotal === undefined ||
    row.payment_resource_id === null
  ) {
    return 0;
  }
  try {
    return await processor.fetchRefundedTotal(row.payment_resource_id);
  } catch (error) {
    if (!(error instanceof PaymentProcessorError)) throw error;
    return 'REFUND_PROCESSOR_ERROR';
  }
}

/**
 * An operator prepares the refund of a request: the amount and whether the units go back to the
 * shelf. The amount cannot exceed what the order paid minus what is already refunded or being
 * refunded, here or at the processor (T2.2).
 *
 * @param tx - The caller's transaction.
 * @param id - `order_returns.id`.
 * @param input - Amount and restock decision.
 * @param actor - Who prepares.
 * @param now - Clock.
 * @returns The request after the change, or why nothing changed.
 */
export async function prepareReturn(
  tx: TxQuery,
  id: number,
  input: {
    refundMxnCents: number;
    restock: boolean;
    processorRefundedCents: number;
  },
  actor: Actor,
  now: Date
): Promise<ReturnView | ReturnRefusal> {
  const [row] = await tx.query<{
    order_id: number;
    status: string;
    total_mxn_cents: number;
  }>(
    'SELECT r.order_id, r.status, o.total_mxn_cents FROM order_returns r JOIN orders o ON o.id = r.order_id WHERE r.id = ? FOR UPDATE',
    [id]
  );
  if (row === undefined) return 'RETURN_NOT_FOUND';
  if (row.status !== 'REQUESTED') return 'RETURN_STATUS_CONFLICT';
  const committed =
    (await committedCents(tx, row.order_id, id)) +
    (await outsideRefundedCents(
      tx,
      row.order_id,
      input.processorRefundedCents
    ));
  if (committed + input.refundMxnCents > Number(row.total_mxn_cents)) {
    return 'INVALID_REFUND_AMOUNT_REJECT';
  }
  await tx.query(
    "UPDATE order_returns SET status = 'PREPARED', refund_mxn_cents = ?, restock = ?, prepared_by = ?, prepared_at = ? WHERE id = ?",
    [input.refundMxnCents, input.restock ? 1 : 0, actor.userId, now, id]
  );
  await recordAudit(tx, {
    userId: actor.userId,
    action: 'RETURN_PREPARED',
    entityType: 'order_returns',
    entityId: String(id),
    before: { status: 'REQUESTED' },
    after: {
      status: 'PREPARED',
      refundCents: input.refundMxnCents,
      restock: input.restock,
    },
    ip: actor.ip,
  });
  return viewOf(tx, id);
}

/** How a counter sale is paid back: cash from the drawer, or the terminal (FC 076). */
type RefundMethod = 'CASH' | 'TERMINAL';

/** Who took the money: a processor, or LOCAL for the counter (FC 076). */
type OrderProcessor = ProcessorCode | 'LOCAL';

/** What the processor call needs, read when the intent is recorded. */
interface RefundIntent {
  returnId: number;
  orderId: number;
  orderNumber: string;
  processor: OrderProcessor;
  paymentResourceId: string | null;
  refundMxnCents: number;
}

/**
 * First transaction of a confirmation: the gate of T1.2 and, when it passes, the intent (the
 * request is REFUNDING with its confirmer). A request already REFUNDED answers as it is.
 */
async function beginRefund(
  tx: TxQuery,
  id: number,
  confirmer: {
    userId: string;
    canConfirm: boolean;
    hasManualReference: boolean;
    refundMethod: RefundMethod | null;
  },
  now: Date,
  ip: string | null,
  processorRefundedCents: number
): Promise<
  | { kind: 'refusal'; code: ReturnRefusal }
  | { kind: 'done' }
  | { kind: 'go'; intent: RefundIntent }
> {
  const [row] = await tx.query<{
    order_id: number;
    order_number: string;
    status: string;
    prepared_by: string | null;
    refund_mxn_cents: number | null;
    total_mxn_cents: number;
    payment_resource_id: string | null;
    processor_code: OrderProcessor;
  }>(
    'SELECT r.order_id, o.order_number, r.status, r.prepared_by, r.refund_mxn_cents, o.total_mxn_cents, o.payment_resource_id, p.code AS processor_code FROM order_returns r JOIN orders o ON o.id = r.order_id JOIN payment_methods m ON m.id = o.payment_method_id JOIN payment_processors p ON p.id = m.processor_id WHERE r.id = ? FOR UPDATE',
    [id]
  );
  if (row === undefined) return { kind: 'refusal', code: 'RETURN_NOT_FOUND' };
  if (row.status === 'REFUNDED') return { kind: 'done' };
  const refundCents = Number(row.refund_mxn_cents ?? 0);
  // What the processor refunded outside the store counts only the first time: a retry of a
  // request that stayed REFUNDING finds its own refund there already.
  const outside =
    row.status === 'PREPARED'
      ? await outsideRefundedCents(tx, row.order_id, processorRefundedCents)
      : 0;
  const committed = (await committedCents(tx, row.order_id, id)) + outside;
  const verdict = decideConfirmation({
    prepared: row.status === 'PREPARED' || row.status === 'REFUNDING',
    authorized: confirmer.canConfirm,
    samePerson: row.prepared_by === confirmer.userId,
    amountOk:
      refundCents > 0 && committed + refundCents <= Number(row.total_mxn_cents),
  });
  if (verdict !== 'REFUND_CONFIRMED_EXECUTE') {
    return { kind: 'refusal', code: verdict };
  }
  if (row.processor_code === 'MERCADO_PAGO' && !confirmer.hasManualReference) {
    return { kind: 'refusal', code: 'MANUAL_REFERENCE_REQUIRED' };
  }
  // FC 076 F3: a counter sale is paid back by hand, in cash or on the terminal.
  if (row.processor_code === 'LOCAL') {
    if (confirmer.refundMethod === null) {
      return { kind: 'refusal', code: 'REFUND_METHOD_REQUIRED' };
    }
    if (
      confirmer.refundMethod === 'TERMINAL' &&
      !confirmer.hasManualReference
    ) {
      return { kind: 'refusal', code: 'MANUAL_REFERENCE_REQUIRED' };
    }
  }
  await tx.query(
    "UPDATE order_returns SET status = 'REFUNDING', confirmed_by = ?, confirmed_at = ? WHERE id = ?",
    [confirmer.userId, now, id]
  );
  await recordAudit(tx, {
    userId: confirmer.userId,
    action: 'RETURN_REFUND_INTENT',
    entityType: 'order_returns',
    entityId: String(id),
    before: { status: row.status },
    after: { status: 'REFUNDING', refundCents },
    ip,
  });
  return {
    kind: 'go',
    intent: {
      returnId: id,
      orderId: row.order_id,
      orderNumber: row.order_number,
      processor: row.processor_code,
      paymentResourceId: row.payment_resource_id,
      refundMxnCents: refundCents,
    },
  };
}

/** Takes the cash of a counter return from the open drawer, or says why it cannot. */
async function payFromDrawer(
  tx: TxQuery,
  intent: RefundIntent,
  userId: string
): Promise<
  'POS_SHIFT_CLOSED_REJECT' | 'INSUFFICIENT_DRAWER_CASH_REJECT' | null
> {
  const [open] = await tx.query<{
    id: number;
    opening_cash_mxn_cents: number | string;
  }>(
    "SELECT id, opening_cash_mxn_cents FROM pos_shifts WHERE status = 'OPEN' FOR UPDATE"
  );
  if (open === undefined) return 'POS_SHIFT_CLOSED_REJECT';
  if (intent.refundMxnCents > (await drawerCash(tx, open))) {
    return 'INSUFFICIENT_DRAWER_CASH_REJECT';
  }
  await writeMovement(
    tx,
    {
      shiftId: Number(open.id),
      type: 'OUT',
      amountMxnCents: intent.refundMxnCents,
      reason: `Devolución mostrador #${intent.returnId}`,
      returnId: intent.returnId,
    },
    userId
  );
  return null;
}

/**
 * Second transaction of a confirmation: the request is REFUNDED, the units go back to the shelf if
 * the operator said so (T2.3), the order becomes REFUNDED when the refunds add up to its total
 * (T2.2) and the buyer is told. A request that is not REFUNDING any more was closed already.
 */
async function finishRefund(
  tx: TxQuery,
  intent: RefundIntent,
  reference: {
    refundId: string | null;
    manualReference: string | null;
    refundMethod: RefundMethod | null;
  },
  confirmer: Actor,
  processorRefundedCents: number
): Promise<ReturnView | ReturnRefusal> {
  const [row] = await tx.query<{ status: string; restock: number }>(
    'SELECT status, restock FROM order_returns WHERE id = ? FOR UPDATE',
    [intent.returnId]
  );
  if (row.status !== 'REFUNDING') return viewOf(tx, intent.returnId);
  const counter = intent.processor === 'LOCAL';
  // The cash leaves the drawer in the same transaction that closes the return (FC 076 T2.6).
  if (counter && reference.refundMethod === 'CASH') {
    const refused = await payFromDrawer(tx, intent, confirmer.userId);
    if (refused !== null) return refused;
  }
  await tx.query(
    "UPDATE order_returns SET status = 'REFUNDED', processor_refund_id = ?, manual_reference = ?, refund_method = ? WHERE id = ?",
    [
      reference.refundId,
      reference.manualReference,
      counter ? reference.refundMethod : null,
      intent.returnId,
    ]
  );
  if (Number(row.restock) === 1) {
    await tx.query(
      'UPDATE products p JOIN order_items i ON i.product_id = p.id JOIN order_return_items ri ON ri.order_item_id = i.id SET p.stock = p.stock + ri.quantity WHERE ri.return_id = ?',
      [intent.returnId]
    );
  }
  const [order] = await tx.query<{
    status_id: number;
    total_mxn_cents: number;
  }>('SELECT status_id, total_mxn_cents FROM orders WHERE id = ? FOR UPDATE', [
    intent.orderId,
  ]);
  // The order is settled when everything it paid has gone back: the requests of the store add up
  // to it, or the processor says so, which also counts a refund made outside the store (T2.2).
  const refunded = Math.max(
    (await committedCents(tx, intent.orderId, intent.returnId)) +
      intent.refundMxnCents,
    processorRefundedCents
  );
  const total = refunded >= Number(order.total_mxn_cents);
  const settles = total && PAID_STATUSES.has(Number(order.status_id));
  if (settles) {
    await tx.query('UPDATE orders SET status_id = ? WHERE id = ?', [
      REFUNDED_ORDER,
      intent.orderId,
    ]);
  }
  // A counter sale has no account to write to.
  if (!counter) {
    await enqueueMail(tx, {
      type: 'RETURN_REFUNDED',
      orderId: intent.orderId,
      refundMxnCents: intent.refundMxnCents,
    });
  }
  await recordAudit(tx, {
    userId: confirmer.userId,
    action: 'RETURN_REFUNDED',
    entityType: 'order_returns',
    entityId: String(intent.returnId),
    before: { status: 'REFUNDING' },
    after: {
      status: 'REFUNDED',
      refundCents: intent.refundMxnCents,
      restocked: Number(row.restock) === 1,
      orderRefunded: settles,
    },
    ip: confirmer.ip,
  });
  return viewOf(tx, intent.returnId);
}

/** The answer of a route: status and JSON body. */
interface Answer {
  status: number;
  body: unknown;
}

const refusalAnswer = (code: ReturnRefusal): Answer => {
  const [status, title] = RETURN_REFUSALS[code];
  return { status, body: problem(status, title, code) };
};

/**
 * A confirmer executes the refund: gate and intent, the processor, close (T1.2, T2.4).
 *
 * @param deps - Database, the configured processors and the clock.
 * @param id - `order_returns.id`.
 * @param confirmer - Who confirms, whether the session holds `returns:confirm`, and the reference
 *   of a refund made by hand at Mercado Pago.
 * @param ip - Client address, for the audit entries.
 * @returns The answer of the route.
 */
export async function confirmReturn(
  deps: {
    db: Db & Transactional;
    processors: Partial<Record<ProcessorCode, PaymentProcessorPort>>;
    now: () => Date;
  },
  id: number,
  confirmer: {
    userId: string;
    canConfirm: boolean;
    manualReference: string | null;
    /** How a counter sale is paid back (FC 076 F3). */
    refundMethod?: RefundMethod | null;
  },
  ip: string | null
): Promise<Answer> {
  const processorRefunded = await readProcessorRefunded(deps, id);
  if (processorRefunded === 'REFUND_PROCESSOR_ERROR') {
    return refusalAnswer(processorRefunded);
  }
  const begun = await deps.db.transaction((tx) =>
    beginRefund(
      tx,
      id,
      {
        userId: confirmer.userId,
        canConfirm: confirmer.canConfirm,
        hasManualReference: confirmer.manualReference !== null,
        refundMethod: confirmer.refundMethod ?? null,
      },
      deps.now(),
      ip,
      processorRefunded
    )
  );
  if (begun.kind === 'refusal') return refusalAnswer(begun.code);
  if (begun.kind === 'done') {
    return { status: 200, body: await viewOf(deps.db, id) };
  }
  const { intent } = begun;
  let refundId: string | null = null;
  if (intent.processor === 'STRIPE') {
    const processor = deps.processors.STRIPE;
    if (
      processor?.createRefund === undefined ||
      intent.paymentResourceId === null
    ) {
      return refusalAnswer('REFUND_PROCESSOR_UNAVAILABLE');
    }
    try {
      refundId = (
        await processor.createRefund({
          paymentResourceId: intent.paymentResourceId,
          amountMxnCents: intent.refundMxnCents,
          idempotencyKey: `yekora-return-${intent.returnId}`,
        })
      ).refundId;
    } catch (error) {
      if (!(error instanceof PaymentProcessorError)) throw error;
      return refusalAnswer('REFUND_PROCESSOR_ERROR');
    }
  }
  // The money has moved: ask the processor again, since what it holds now includes this refund
  // and any made outside the store. If it cannot answer, the closing goes on with our requests.
  const settled = await readProcessorRefunded(deps, id);
  const view = await deps.db.transaction((tx) =>
    finishRefund(
      tx,
      intent,
      {
        refundId,
        manualReference: confirmer.manualReference,
        refundMethod: confirmer.refundMethod ?? null,
      },
      { userId: confirmer.userId, ip },
      typeof settled === 'number' ? settled : 0
    )
  );
  return typeof view === 'string'
    ? refusalAnswer(view)
    : { status: 200, body: view };
}

/**
 * Whether the refunds a processor reports for a charge are the ones this store made through a
 * request (FC 069 link, T2.2): every refund id is recorded in a request, or the ones not recorded
 * yet are covered by requests still REFUNDING (the webhook can arrive before the close).
 *
 * @param db - Database port.
 * @param orderId - `orders.id`.
 * @param refundIds - The ids of the refunds of the charge, as the processor lists them.
 * @returns True when the webhook announces our own refund and the request governs the effects.
 */
export async function isReturnRefund(
  db: TxQuery,
  orderId: number,
  refundIds: readonly string[]
): Promise<boolean> {
  if (refundIds.length === 0) return false;
  const [[known], [inFlight]] = await Promise.all([
    db.query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM order_returns WHERE order_id = ? AND processor_refund_id IN (?)',
      [orderId, [...refundIds]]
    ),
    db.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM order_returns WHERE order_id = ? AND status = 'REFUNDING'",
      [orderId]
    ),
  ]);
  return refundIds.length - Number(known.n) <= Number(inFlight.n);
}
