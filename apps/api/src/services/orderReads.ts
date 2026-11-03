/**
 * Order reads of the account area and the panel (FC 028 F1, T2.6): lists and one order with its
 * lines and payment events. Read-only: nothing here writes, and the routes that use it refuse
 * every write with 405 (routes/orders.ts). Static parameterized SQL only (ADR 0003).
 *
 * The data domain is decided by the caller's scope (T1.2 D, T2.6b): a buyer's list is always
 * filtered by the session's `user_id`; the panel's list is global and may filter by status.
 * The detail returns its owner so the route can refuse another buyer's order.
 *
 * @module
 */
import type {
  OrderDetail,
  OrderSummary,
} from '../../../../lib/account/orderTypes';
import type { Db } from './db';

/** Columns of an order row, as the summary reads them. */
interface OrderRow {
  order_number: string;
  status: string;
  method: string;
  items_total_mxn_cents: number | string;
  shipping_total_mxn_cents: number | string;
  total_mxn_cents: number | string;
  created_at: Date;
  expires_at: Date;
  paid_at: Date | null;
  is_test: number;
}

/** Who is listing: one buyer (their own orders), or the panel (every order, maybe one status). */
type OrderScope = { userId: string } | { status: string | null };

/** The page of a list. */
interface Paging {
  page: number;
  pageSize: number;
}

const iso = (date: Date) => new Date(date).toISOString();

function summary(row: OrderRow): OrderSummary {
  return {
    orderNumber: row.order_number,
    status: row.status as OrderSummary['status'],
    method: row.method as OrderSummary['method'],
    itemsTotalMxnCents: Number(row.items_total_mxn_cents),
    shippingTotalMxnCents: Number(row.shipping_total_mxn_cents),
    totalMxnCents: Number(row.total_mxn_cents),
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    paidAt: row.paid_at === null ? null : iso(row.paid_at),
    isTest: Number(row.is_test) === 1,
  };
}

/**
 * One page of orders, newest first.
 *
 * @param db - Database port.
 * @param scope - A buyer (filtered by `user_id`) or the panel (optionally one status).
 * @param paging - Page number and size.
 * @returns The orders of the page and the total of the scope.
 */
export async function listOrders(
  db: Db,
  scope: OrderScope,
  { page, pageSize }: Paging
): Promise<{ items: OrderSummary[]; total: number }> {
  const offset = (page - 1) * pageSize;
  const [rows, [count]] =
    'userId' in scope
      ? await Promise.all([
          db.query<OrderRow>(
            'SELECT o.order_number, s.code AS status, m.code AS method, o.items_total_mxn_cents, o.shipping_total_mxn_cents, o.total_mxn_cents, o.created_at, o.expires_at, o.paid_at, o.is_test FROM orders o JOIN order_statuses s ON s.id = o.status_id JOIN payment_methods m ON m.id = o.payment_method_id WHERE o.user_id = ? ORDER BY o.created_at DESC, o.id DESC LIMIT ? OFFSET ?',
            [scope.userId, pageSize, offset]
          ),
          db.query<{ n: number }>(
            'SELECT COUNT(*) AS n FROM orders WHERE user_id = ?',
            [scope.userId]
          ),
        ])
      : await Promise.all([
          db.query<OrderRow>(
            'SELECT o.order_number, s.code AS status, m.code AS method, o.items_total_mxn_cents, o.shipping_total_mxn_cents, o.total_mxn_cents, o.created_at, o.expires_at, o.paid_at, o.is_test FROM orders o JOIN order_statuses s ON s.id = o.status_id JOIN payment_methods m ON m.id = o.payment_method_id WHERE (? IS NULL OR s.code = ?) ORDER BY o.created_at DESC, o.id DESC LIMIT ? OFFSET ?',
            [scope.status, scope.status, pageSize, offset]
          ),
          db.query<{ n: number }>(
            'SELECT COUNT(*) AS n FROM orders o JOIN order_statuses s ON s.id = o.status_id WHERE (? IS NULL OR s.code = ?)',
            [scope.status, scope.status]
          ),
        ]);
  return { items: rows.map(summary), total: Number(count.n) };
}

/**
 * One order with its lines and payment events, and the account that owns it.
 *
 * @param db - Database port.
 * @param orderNumber - Public order number.
 * @returns The order and its owner (null for a guest purchase), or null when it does not exist.
 */
export async function findOrder(
  db: Db,
  orderNumber: string
): Promise<{ ownerId: string | null; order: OrderDetail } | null> {
  const [row] = await db.query<
    OrderRow & { id: number; user_id: string | null }
  >(
    'SELECT o.id, o.user_id, o.order_number, s.code AS status, m.code AS method, o.items_total_mxn_cents, o.shipping_total_mxn_cents, o.total_mxn_cents, o.created_at, o.expires_at, o.paid_at, o.is_test FROM orders o JOIN order_statuses s ON s.id = o.status_id JOIN payment_methods m ON m.id = o.payment_method_id WHERE o.order_number = ?',
    [orderNumber]
  );
  if (row === undefined) return null;
  const [lines, events] = await Promise.all([
    db.query<{
      sku: string;
      quantity: number;
      unit_price_mxn_cents: number | string;
      line_total_mxn_cents: number | string;
    }>(
      'SELECT sku, quantity, unit_price_mxn_cents, line_total_mxn_cents FROM order_items WHERE order_id = ? ORDER BY id',
      [row.id]
    ),
    db.query<{
      processor: string;
      event_type: string;
      processor_status: string | null;
      amount_mxn_cents: number | string | null;
      resulting_status: string | null;
      is_alert: number;
      received_at: Date;
    }>(
      'SELECT p.code AS processor, e.event_type, e.processor_status, e.amount_mxn_cents, r.code AS resulting_status, e.is_alert, e.received_at FROM payment_events e JOIN payment_processors p ON p.id = e.processor_id LEFT JOIN order_statuses r ON r.id = e.resulting_status_id WHERE e.order_id = ? ORDER BY e.received_at, e.id',
      [row.id]
    ),
  ]);
  type Event = OrderDetail['paymentEvents'][number];
  return {
    ownerId: row.user_id,
    order: {
      ...summary(row),
      lines: lines.map((line) => ({
        sku: line.sku,
        quantity: Number(line.quantity),
        unitPriceMxnCents: Number(line.unit_price_mxn_cents),
        lineTotalMxnCents: Number(line.line_total_mxn_cents),
      })),
      paymentEvents: events.map((event) => ({
        processor: event.processor as Event['processor'],
        eventType: event.event_type,
        processorStatus: event.processor_status,
        amountMxnCents:
          event.amount_mxn_cents === null
            ? null
            : Number(event.amount_mxn_cents),
        resultingStatus: event.resulting_status as Event['resultingStatus'],
        isAlert: Number(event.is_alert) === 1,
        receivedAt: iso(event.received_at),
      })),
    },
  };
}
