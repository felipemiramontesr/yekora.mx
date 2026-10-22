/**
 * `GET /v1/orders/:order_number` (FC 012 F2): the buyer's view of one order, for the return
 * pages. Access needs the order's token in `Authorization: Bearer <token>`; the token was handed
 * to the browser once and is stored only as an HMAC, compared in constant time. A missing,
 * wrong or unknown order or token gets the same 404, so the endpoint never tells which order
 * numbers exist (A01). No personal data leaves: only status, method, amounts and times.
 *
 * Expired reservations are released before reading, so a lapsed order reads EXPIRED.
 *
 * @module
 */
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { orderViewSchema } from '../../../../lib/checkout/checkoutTypes';
import type { PaymentsConfig } from '../config';
import { problem, PROBLEM_TYPE } from '../lib/problem';
import { expireOverdueOrders } from '../services/checkout';
import { tokenHash } from '../services/checkoutCrypto';
import type { Db, Transactional } from '../services/db';

/** Dependencies of the order route. */
interface OrderDeps {
  /** Database with transactions (lazy expiry). */
  db: Db & Transactional;
  /** Checkout secrets (the token pepper). */
  payments: PaymentsConfig;
  /** Clock, injectable for tests. */
  now: () => Date;
}

interface OrderRow {
  order_number: string;
  status: string;
  method: string;
  items_total_mxn_cents: number;
  shipping_total_mxn_cents: number;
  total_mxn_cents: number;
  expires_at: Date;
  paid_at: Date | null;
  access_token_hash: Buffer;
}

const ORDER_NUMBER = /^YEK-\d{4}-[0-9A-Z]{8}$/;
const BEARER = /^Bearer ([\w-]{43})$/;

/**
 * Registers the order status route.
 *
 * @param app - Fastify instance.
 * @param deps - Database, configuration and clock.
 */
export function registerOrderRoutes(
  app: FastifyInstance,
  deps: OrderDeps
): void {
  app.get(
    '/v1/orders/:order_number',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const notFound = () =>
        reply.code(404).type(PROBLEM_TYPE).send(problem(404, 'Not found'));
      const secrets = deps.payments.checkout;
      if (secrets === null) {
        return reply
          .code(503)
          .type(PROBLEM_TYPE)
          .send(problem(503, 'Payments unavailable', 'SERVICE_UNAVAILABLE'));
      }
      const { order_number: orderNumber } = request.params as {
        order_number: string;
      };
      const token = BEARER.exec(request.headers.authorization ?? '')?.[1];
      if (!ORDER_NUMBER.test(orderNumber) || token === undefined)
        return notFound();

      await expireOverdueOrders(deps.db, deps.now());
      const [row] = await deps.db.query<OrderRow>(
        'SELECT o.order_number, s.code AS status, m.code AS method, o.items_total_mxn_cents, o.shipping_total_mxn_cents, o.total_mxn_cents, o.expires_at, o.paid_at, o.access_token_hash FROM orders o JOIN order_statuses s ON s.id = o.status_id JOIN payment_methods m ON m.id = o.payment_method_id WHERE o.order_number = ?',
        [orderNumber]
      );
      if (
        row === undefined ||
        !timingSafeEqual(
          Buffer.from(row.access_token_hash),
          tokenHash(secrets.tokenPepper, token)
        )
      ) {
        return notFound();
      }
      // Validated on the way out: the same contract the return pages parse.
      return orderViewSchema.parse({
        orderNumber: row.order_number,
        status: row.status,
        method: row.method,
        itemsTotalMxnCents: Number(row.items_total_mxn_cents),
        shippingTotalMxnCents: Number(row.shipping_total_mxn_cents),
        totalMxnCents: Number(row.total_mxn_cents),
        expiresAt: new Date(row.expires_at).toISOString(),
        paidAt:
          row.paid_at === null ? null : new Date(row.paid_at).toISOString(),
      });
    }
  );
}
