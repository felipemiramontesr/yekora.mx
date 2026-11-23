/**
 * Payment webhooks (FC 012 F2): T1.3 WebhookIngestionGate(V, N, R) in order V → N → R, then
 * T1.4 for a reconciled payment.
 *
 * - V: the adapter checks the signature over the raw bytes in constant time.
 * - N: an event already in `payment_events` is acknowledged without touching anything; a
 *   second insert of the same event (two deliveries at once) is caught by the unique key.
 * - R: the notification is never trusted. The payment is fetched from the processor and must be
 *   paid, in MXN, for the exact total of an order of that same processor.
 *
 * A failure to reach the processor answers 503 without recording the event, so the processor
 * retries it. The payload is never stored (it may carry the payer's data).
 *
 * @module
 */
import type { PaymentsConfig } from '../config';
import type { ProcessorCode } from './checkout';
import type { Db, Transactional, TxQuery } from './db';
import type {
  PaymentProcessorPort,
  PaymentStatus,
  VerifiedEvent,
  WebhookInput,
} from './paymentPort';
import { enqueueMail } from './outbox';
import { applyRefund, decideRefund } from './refundFsm';
import { settle } from './settlement';

/** Dependencies of the webhook receiver. */
export interface WebhookDeps {
  /** Database with transactions. */
  db: Db & Transactional;
  /** Processors whose secrets are configured. */
  processors: Partial<Record<ProcessorCode, PaymentProcessorPort>>;
  /** Payments mode: sandbox events are marked as tests. */
  payments: PaymentsConfig;
  /** Clock, injectable for tests. */
  now: () => Date;
}

/** HTTP status and machine code of one delivery. */
interface WebhookOutcome {
  /** HTTP status. */
  status: number;
  /** Code of T1.3 or T1.4, or SERVICE_UNAVAILABLE. */
  code: string;
}

const PROCESSOR_ID: Record<ProcessorCode, number> = {
  STRIPE: 1,
  MERCADO_PAGO: 2,
};

/** Event types that can carry a settled payment; any other one is R = ⊥. */
const SETTLING_TYPES: Record<ProcessorCode, readonly string[]> = {
  STRIPE: [
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
  ],
  MERCADO_PAGO: ['payment'],
};

/** Event types that announce a refunded charge (FC 069). Mercado Pago's refunds are not heard. */
const REFUND_TYPES: Record<ProcessorCode, readonly string[]> = {
  STRIPE: ['charge.refunded'],
  MERCADO_PAGO: [],
};

const STATUS = { PENDING: 1, PAID: 2, EXPIRED: 3, CANCELLED: 4 } as const;

interface OrderRow {
  id: number;
  total_mxn_cents: number;
}

/** What R found: the payment as the processor reports it and the order it names. */
interface Reconciliation {
  payment: PaymentStatus | null;
  order: OrderRow | null;
  confirmed: boolean;
}

/** The event row, without the payload. */
interface EventRecord {
  processorId: number;
  event: VerifiedEvent;
  reconciliation: Reconciliation;
  resultingStatusId: number | null;
  alert: boolean;
  isTest: boolean;
}

/**
 * Records the event once; false when another delivery of it was recorded first. The unique key
 * decides, through its duplicate error: mysql2 reports found rows, so an `ON DUPLICATE KEY`
 * no-op would count as one affected row and hide the duplicate.
 */
async function recordEvent(tx: TxQuery, record: EventRecord): Promise<boolean> {
  const { payment, order } = record.reconciliation;
  try {
    await tx.query(
      'INSERT INTO payment_events (processor_id, event_id, event_type, order_id, processor_status, amount_mxn_cents, currency, resulting_status_id, is_alert, is_test) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        record.processorId,
        record.event.eventId,
        record.event.type,
        order?.id ?? null,
        payment?.processorStatus ?? null,
        payment?.amountMxnCents ?? null,
        payment?.currency ?? null,
        record.resultingStatusId,
        record.alert ? 1 : 0,
        record.isTest ? 1 : 0,
      ]
    );
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ER_DUP_ENTRY') return false;
    throw error;
  }
  return true;
}

/** R: asks the processor; a paid charge that does not match an order is recorded as an alert. */
async function reconcile(
  deps: WebhookDeps,
  code: ProcessorCode,
  processor: PaymentProcessorPort,
  event: VerifiedEvent
): Promise<Reconciliation> {
  if (event.resourceId === null || !SETTLING_TYPES[code].includes(event.type)) {
    return { payment: null, order: null, confirmed: false };
  }
  const payment = await processor.fetchPayment(event.resourceId);
  const [order] = await deps.db.query<OrderRow>(
    'SELECT o.id, o.total_mxn_cents FROM orders o JOIN payment_methods m ON m.id = o.payment_method_id WHERE o.order_number = ? AND m.processor_id = ?',
    [payment.orderNumber, PROCESSOR_ID[code]]
  );
  const confirmed =
    payment.paid &&
    order !== undefined &&
    payment.currency === 'MXN' &&
    payment.amountMxnCents === Number(order.total_mxn_cents);
  return { payment, order: order ?? null, confirmed };
}

/** Order of a refunded session, looked up by the session the payment was taken in. */
interface RefundOrderRow extends OrderRow {
  order_number: string;
}

/** The unreconciled and partial refunds are recorded as alerts: nothing changes but someone looks. */
function recordRefundAlert(
  deps: WebhookDeps,
  base: Omit<EventRecord, 'resultingStatusId' | 'alert'>,
  code: string
): Promise<WebhookOutcome> {
  return deps.db.transaction(async (tx) => {
    const recorded = await recordEvent(tx, {
      ...base,
      resultingStatusId: null,
      alert: true,
    });
    return { status: 200, code: recorded ? code : 'IDEMPOTENT_IGNORED' };
  });
}

/** T1.2 and T1.3 of FC 069 on the locked order, with the event recorded in the same transaction. */
function refundOrder(
  deps: WebhookDeps,
  base: Omit<EventRecord, 'resultingStatusId' | 'alert'>,
  order: RefundOrderRow
): Promise<WebhookOutcome> {
  return deps.db.transaction(async (tx) => {
    const [current] = await tx.query<{ status_id: number }>(
      'SELECT status_id FROM orders WHERE id = ? FOR UPDATE',
      [order.id]
    );
    const status = Number(current.status_id);
    const outcome = decideRefund(status);
    const conflict = outcome === 'REFUND_STATUS_CONFLICT_ANOMALY';
    const recorded = await recordEvent(tx, {
      ...base,
      resultingStatusId: conflict ? status : 5,
      alert: conflict,
    });
    if (!recorded) return { status: 200, code: 'IDEMPOTENT_IGNORED' };
    if (conflict) return { status: 500, code: outcome };
    if (outcome === 'IDEMPOTENT_IGNORED') {
      return { status: 200, code: outcome };
    }
    await applyRefund(tx, order.id, order.order_number, outcome);
    return { status: 200, code: 'REFUND_PROCESSED' };
  });
}

/**
 * FC 069: a refunded charge. It is read back from the processor, matched to the order whose
 * session took the payment, and only a refund of the whole charge moves the order.
 */
async function receiveRefund(
  deps: WebhookDeps,
  code: ProcessorCode,
  processor: PaymentProcessorPort,
  event: VerifiedEvent,
  isTest: boolean
): Promise<WebhookOutcome> {
  const processorId = PROCESSOR_ID[code];
  const nothing: Reconciliation = {
    payment: null,
    order: null,
    confirmed: false,
  };
  const unreconciled = (reconciliation: Reconciliation = nothing) =>
    recordRefundAlert(
      deps,
      { processorId, event, reconciliation, isTest },
      'REFUND_UNRECONCILED_ALERT'
    );
  if (event.resourceId === null || processor.fetchRefund === undefined) {
    return unreconciled();
  }
  let refund;
  try {
    refund = await processor.fetchRefund(event.resourceId);
  } catch {
    return { status: 503, code: 'SERVICE_UNAVAILABLE' };
  }
  if (refund === null) return unreconciled();
  const [order] = await deps.db.query<RefundOrderRow>(
    'SELECT o.id, o.order_number, o.total_mxn_cents FROM orders o JOIN payment_methods m ON m.id = o.payment_method_id WHERE o.order_number = ? AND m.processor_id = ? AND o.payment_resource_id = ?',
    [refund.orderNumber, processorId, refund.sessionId]
  );
  const payment: PaymentStatus = {
    paid: false,
    amountMxnCents: refund.refundedMxnCents,
    currency: refund.currency,
    orderNumber: refund.orderNumber,
    processorStatus: 'refunded',
  };
  if (
    order === undefined ||
    refund.currency !== 'MXN' ||
    refund.amountMxnCents !== Number(order.total_mxn_cents)
  ) {
    return unreconciled({ payment, order: null, confirmed: false });
  }
  const base = {
    processorId,
    event,
    reconciliation: { payment, order, confirmed: true },
    isTest,
  };
  return refund.refundedMxnCents >= refund.amountMxnCents
    ? refundOrder(deps, base, order)
    : recordRefundAlert(deps, base, 'PARTIAL_REFUND_ALERT');
}

/** T1.4 on the locked order, with the event recorded in the same transaction. */
function settleOrder(
  deps: WebhookDeps,
  base: Omit<EventRecord, 'resultingStatusId' | 'alert'>,
  order: OrderRow
): Promise<WebhookOutcome> {
  const resourceId = base.event.resourceId as string;
  return deps.db.transaction(async (tx) => {
    const [current] = await tx.query<{
      status_id: number;
      payment_resource_id: string | null;
    }>(
      'SELECT status_id, payment_resource_id FROM orders WHERE id = ? FOR UPDATE',
      [order.id]
    );
    const status = Number(current.status_id);
    const row = settle(
      status === STATUS.PENDING,
      status === STATUS.PAID && current.payment_resource_id === resourceId,
      status === STATUS.EXPIRED || status === STATUS.CANCELLED
    );
    const recorded = await recordEvent(tx, {
      ...base,
      resultingStatusId: row.nextStatusId ?? status,
      alert: row.alert,
    });
    if (!recorded) return { status: 200, code: 'IDEMPOTENT_IGNORED' };
    if (row.nextStatusId !== null) {
      await tx.query(
        'UPDATE orders SET status_id = ?, paid_at = ?, payment_resource_id = ? WHERE id = ?',
        [row.nextStatusId, deps.now(), resourceId, order.id]
      );
    }
    if (row.sellsStock) {
      await tx.query(
        'UPDATE products p JOIN order_items i ON i.product_id = p.id SET p.stock = p.stock - i.quantity, p.reserved_stock = p.reserved_stock - i.quantity WHERE i.order_id = ?',
        [order.id]
      );
    }
    // FC 066 T1.2: a recorded event that moves a pending order to PAID queues its confirmation, in
    // this same transaction (T2.4). A repeated delivery returned above, so it queues nothing (T2.1).
    if (status === STATUS.PENDING && row.nextStatusId === STATUS.PAID) {
      await enqueueMail(tx, { type: 'ORDER_CONFIRMED', orderId: order.id });
    }
    return { status: row.httpStatus, code: row.code };
  });
}

/**
 * Handles one webhook delivery.
 *
 * @param deps - Database, processors, configuration and clock.
 * @param code - The processor the delivery came to.
 * @param input - Raw body, headers and query as received.
 * @returns The HTTP status and code to answer.
 */
export async function receiveWebhook(
  deps: WebhookDeps,
  code: ProcessorCode,
  input: Omit<WebhookInput, 'now'>
): Promise<WebhookOutcome> {
  const processor = deps.processors[code];
  if (processor === undefined) {
    return { status: 503, code: 'SERVICE_UNAVAILABLE' };
  }
  // V
  const event = processor.verifyWebhook({ ...input, now: deps.now() });
  if (event === null) return { status: 401, code: 'INVALID_SIGNATURE' };
  // N
  const processorId = PROCESSOR_ID[code];
  const [seen] = await deps.db.query(
    'SELECT id FROM payment_events WHERE processor_id = ? AND event_id = ?',
    [processorId, event.eventId]
  );
  if (seen !== undefined) return { status: 200, code: 'IDEMPOTENT_IGNORED' };
  const isTest = deps.payments.mode === 'sandbox';
  // FC 069: a refund is reconciled by its own path.
  if (REFUND_TYPES[code].includes(event.type)) {
    return receiveRefund(deps, code, processor, event, isTest);
  }
  // R
  let reconciliation: Reconciliation;
  try {
    reconciliation = await reconcile(deps, code, processor, event);
  } catch {
    return { status: 503, code: 'SERVICE_UNAVAILABLE' };
  }
  const base = {
    processorId,
    event,
    reconciliation,
    isTest,
  };
  if (!reconciliation.confirmed) {
    const recorded = await deps.db.transaction((tx) =>
      recordEvent(tx, {
        ...base,
        resultingStatusId: null,
        // Paid but matching no order of ours, or another amount or currency: someone must look.
        alert: reconciliation.payment?.paid === true,
      })
    );
    return recorded
      ? { status: 200, code: 'PAYMENT_UNCONFIRMED' }
      : { status: 200, code: 'IDEMPOTENT_IGNORED' };
  }
  return settleOrder(deps, base, reconciliation.order as OrderRow);
}
