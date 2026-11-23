/**
 * What a full refund does to an order and to its stock (FC 069 F1, K-76).
 *
 * A refund made at the processor reaches the store as a webhook (services/webhooks.ts). When it
 * refunds the whole charge, the order moves to REFUNDED (5) and the buyer is told, in the same
 * transaction. The stock goes back to the shelf only if the goods never left it:
 *
 * | order was | what it means | result |
 * |---|---|---|
 * | PAID (2) or PREPARING (7) | the units are still in the warehouse | REFUNDED, stock returned |
 * | SHIPPED (8) or DELIVERED (9) | the units left or arrived | REFUNDED, stock untouched (K-80) |
 * | REFUNDED (5) | the refund was already applied | nothing changes (idempotent) |
 * | anything else | never paid, or in review | refused as an anomaly, nothing changes |
 *
 * `paid_at` is never touched, which is what the paid-at check of the database asks of REFUNDED.
 *
 * @module
 */
import { recordAudit } from './audit';
import type { TxQuery } from './db';
import { enqueueMail } from './outbox';

/** The codes of T1.2 and T1.3 of FC 069. */
type RefundOutcome =
  | 'ORDER_REFUNDED_RESTOCK'
  | 'ORDER_REFUNDED_NO_RESTOCK'
  | 'IDEMPOTENT_IGNORED'
  | 'REFUND_STATUS_CONFLICT_ANOMALY';

/** The statuses of `order_statuses` a refund distinguishes. */
const REFUNDED = 5;
const IN_WAREHOUSE: readonly number[] = [2, 7];
const LEFT_WAREHOUSE: readonly number[] = [8, 9];

/**
 * Decides what a full refund does to an order, from its status alone (T1.2 and T1.3).
 *
 * @param statusId - `orders.status_id` read with the order locked.
 * @returns The row of the table.
 */
export function decideRefund(statusId: number): RefundOutcome {
  if (statusId === REFUNDED) return 'IDEMPOTENT_IGNORED';
  if (IN_WAREHOUSE.includes(statusId)) return 'ORDER_REFUNDED_RESTOCK';
  if (LEFT_WAREHOUSE.includes(statusId)) return 'ORDER_REFUNDED_NO_RESTOCK';
  return 'REFUND_STATUS_CONFLICT_ANOMALY';
}

/**
 * Applies a refund that {@link decideRefund} admitted: the order becomes REFUNDED, the units go
 * back to the stock when they never left it, the buyer's notice is queued and the change is
 * audited, all in the caller's transaction (T2.3).
 *
 * @param tx - The transaction that holds the order locked.
 * @param orderId - `orders.id`.
 * @param orderNumber - Public order number, for the audit entry.
 * @param outcome - `ORDER_REFUNDED_RESTOCK` or `ORDER_REFUNDED_NO_RESTOCK`.
 */
export async function applyRefund(
  tx: TxQuery,
  orderId: number,
  orderNumber: string,
  outcome: 'ORDER_REFUNDED_RESTOCK' | 'ORDER_REFUNDED_NO_RESTOCK'
): Promise<void> {
  const restock = outcome === 'ORDER_REFUNDED_RESTOCK';
  await tx.query('UPDATE orders SET status_id = ? WHERE id = ?', [
    REFUNDED,
    orderId,
  ]);
  if (restock) {
    await tx.query(
      'UPDATE products p JOIN order_items i ON i.product_id = p.id SET p.stock = p.stock + i.quantity WHERE i.order_id = ?',
      [orderId]
    );
  }
  await enqueueMail(tx, { type: 'ORDER_REFUNDED', orderId });
  await recordAudit(tx, {
    userId: null,
    action: 'ORDER_REFUNDED',
    entityType: 'orders',
    entityId: orderNumber,
    before: null,
    after: { status: 'REFUNDED', restocked: restock },
    ip: null,
  });
}
