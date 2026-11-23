/**
 * The fulfillment of a paid order (FC 068 F1, K-48): the three steps an operator takes after the
 * payment, each one a transition of the order's status that commits together with its notice.
 *
 * - `prepare`: PAID (2) → PREPARING (7), and the buyer is told it is being prepared;
 * - `ship`: PAID (2) or PREPARING (7) → SHIPPED (8), with the carrier, the tracking number and
 *   the time it left (and an optional link), and the buyer is told it is on its way;
 * - `deliver`: SHIPPED (8) → DELIVERED (9), with the time it arrived.
 *
 * The machine only moves forward (T2.1): no other origin is admitted, so a pending, expired or
 * cancelled order is never fulfilled and a paid one never jumps to DELIVERED. The order row is
 * locked while its status is read and changed, so two operators cannot both win, and the notice
 * is queued in the same transaction (T2.2): it exists if and only if the transition does, and a
 * repeated request finds the order already moved and queues nothing.
 *
 * @module
 */
import type {
  FulfillmentResult,
  ShipRequest,
} from '../../../../lib/account/fulfillmentTypes';
import { recordAudit } from './audit';
import type { TxQuery } from './db';
import { enqueueMail } from './outbox';

/** The three steps. */
export type FulfillmentStep = 'prepare' | 'ship' | 'deliver';

/** Why a transition changed nothing; the route answers with it as the problem's detail. */
export type FulfillmentRefusal = 'ORDER_NOT_FOUND' | 'ORDER_STATUS_CONFLICT';

/** The statuses of `order_statuses` the fulfillment moves between. */
const PAID = 2;
const PREPARING = 7;
const SHIPPED = 8;
const DELIVERED = 9;

/** The statuses each step admits, and where it leads (T2.1). */
const STEPS: Readonly<
  Record<
    FulfillmentStep,
    { from: readonly number[]; to: number; label: string }
  >
> = {
  prepare: { from: [PAID], to: PREPARING, label: 'ORDER_PREPARED' },
  ship: { from: [PAID, PREPARING], to: SHIPPED, label: 'ORDER_SHIPPED' },
  deliver: { from: [SHIPPED], to: DELIVERED, label: 'ORDER_DELIVERED' },
};

/** Who acts, for the audit entry. */
interface Actor {
  /** The operator's user id. */
  userId: string;
  /** Client address. */
  ip: string | null;
}

/** The order as the transition reads it back. */
interface ParcelRow {
  status: string;
  carrier: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  shipped_at: Date | null;
  delivered_at: Date | null;
}

const iso = (date: Date | null) =>
  date === null ? null : new Date(date).toISOString();

/**
 * Moves an order one step forward in its fulfillment.
 *
 * @param tx - The caller's transaction.
 * @param step - `prepare`, `ship` or `deliver`.
 * @param orderNumber - Public order number.
 * @param parcel - The shipment, for `ship`; ignored by the other steps.
 * @param actor - Who acts.
 * @param now - Current time, stored as the moment it left or arrived.
 * @returns The order after the change, or why nothing changed.
 */
export async function transitionOrder(
  tx: TxQuery,
  step: FulfillmentStep,
  orderNumber: string,
  parcel: ShipRequest | null,
  actor: Actor,
  now: Date
): Promise<FulfillmentResult | FulfillmentRefusal> {
  const [order] = await tx.query<{ id: number; status_id: number }>(
    'SELECT id, status_id FROM orders WHERE order_number = ? FOR UPDATE',
    [orderNumber]
  );
  if (order === undefined) return 'ORDER_NOT_FOUND';
  const rule = STEPS[step];
  const before = Number(order.status_id);
  if (!rule.from.includes(before)) return 'ORDER_STATUS_CONFLICT';
  if (step === 'ship') {
    const shipment = parcel as ShipRequest;
    await tx.query(
      'UPDATE orders SET status_id = ?, carrier = ?, tracking_number = ?, tracking_url = ?, shipped_at = ? WHERE id = ?',
      [
        rule.to,
        shipment.carrier,
        shipment.trackingNumber,
        shipment.trackingUrl ?? null,
        now,
        order.id,
      ]
    );
  } else if (step === 'deliver') {
    await tx.query(
      'UPDATE orders SET status_id = ?, delivered_at = ? WHERE id = ?',
      [rule.to, now, order.id]
    );
  } else {
    await tx.query('UPDATE orders SET status_id = ? WHERE id = ?', [
      rule.to,
      order.id,
    ]);
  }
  if (step === 'prepare') {
    await enqueueMail(tx, { type: 'ORDER_PREPARED', orderId: order.id });
  } else if (step === 'ship') {
    await enqueueMail(tx, { type: 'ORDER_SHIPPED', orderId: order.id });
  }
  const [after] = await tx.query<ParcelRow>(
    'SELECT s.code AS status, o.carrier, o.tracking_number, o.tracking_url, o.shipped_at, o.delivered_at FROM orders o JOIN order_statuses s ON s.id = o.status_id WHERE o.id = ?',
    [order.id]
  );
  const result: FulfillmentResult = {
    orderNumber,
    fulfillment: after.status as FulfillmentResult['fulfillment'],
    carrier: after.carrier,
    trackingNumber: after.tracking_number,
    trackingUrl: after.tracking_url,
    shippedAt: iso(after.shipped_at),
    deliveredAt: iso(after.delivered_at),
  };
  await recordAudit(tx, {
    userId: actor.userId,
    action: rule.label,
    entityType: 'orders',
    entityId: orderNumber,
    before: { statusId: before },
    after: { fulfillment: result.fulfillment, carrier: result.carrier },
    ip: actor.ip,
  });
  return result;
}
