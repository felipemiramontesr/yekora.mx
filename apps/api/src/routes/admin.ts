/**
 * The panel (FC 028 F1): `/v1/admin/*`. Every route here needs a granular permission of the
 * catalog (T2.3a); the guard in app.ts checks the session, the authenticator of staff and admin
 * (T2.1a) and the permission before these handlers run, and the audit interceptor
 * (services/audit.ts) records each answered request.
 *
 * Orders, read-only (T2.6): staff with `orders:read` and admin (who holds every permission,
 * T2.3b) see every order, optionally of one status, with its lines and payment events. Writes
 * are refused with 405 (routes/orders.ts).
 *
 * @module
 */
import type { FastifyInstance } from 'fastify';
import {
  adminOrdersQuery,
  orderDetailSchema,
  orderPageSchema,
} from '../../../../lib/account/orderTypes';
import { paymentsHealthSchema } from '../../../../lib/account/paymentsHealthTypes';
import type { PaymentsConfig } from '../config';
import { problem, PROBLEM_TYPE } from '../lib/problem';
import { type CheckoutDeps, expireOverdueOrders } from '../services/checkout';
import type { Db, Transactional } from '../services/db';
import { listOrders } from '../services/orderReads';
import { readPaymentsHealth } from '../services/paymentsHealth';
import { lookUpOrder } from './orders';

/** Dependencies of the panel routes. */
interface AdminDeps {
  /** Database with transactions (lazy expiry of overdue orders). */
  db: Db & Transactional;
  /** Clock. */
  now: () => Date;
  /** The processors whose secrets are configured, for the payments probe (FC 070). */
  processors: CheckoutDeps['processors'];
  /** `PAYMENTS_MODE` of this environment. */
  mode: PaymentsConfig['mode'];
}

/**
 * Registers the panel routes.
 *
 * @param app - Fastify instance.
 * @param deps - Database and clock.
 */
export function registerAdminRoutes(
  app: FastifyInstance,
  deps: AdminDeps
): void {
  app.get('/v1/admin/orders', async (request, reply) => {
    const query = adminOrdersQuery.safeParse(request.query);
    if (!query.success) {
      return reply
        .code(400)
        .type(PROBLEM_TYPE)
        .send(problem(400, 'Invalid query', 'INVALID_REQUEST'));
    }
    const { status, ...paging } = query.data;
    await expireOverdueOrders(deps.db, deps.now());
    const { items, total } = await listOrders(
      deps.db,
      { status: status ?? null },
      paging
    );
    return orderPageSchema.parse({ items, total, ...paging });
  });

  // FC 070 T2.2: reachability of the processors, behind the session, the authenticator and
  // orders:read of the guard. The public GET /health is another route and stays as it is.
  app.get('/v1/admin/payments/health', async () =>
    paymentsHealthSchema.parse(
      await readPaymentsHealth(deps.mode, deps.processors)
    )
  );

  app.get('/v1/admin/orders/:order_number', async (request, reply) => {
    const { order_number: orderNumber } = request.params as {
      order_number: string;
    };
    const found = await lookUpOrder(deps, orderNumber);
    if (found === null) {
      return reply.code(404).type(PROBLEM_TYPE).send(problem(404, 'Not found'));
    }
    return orderDetailSchema.parse(found.order);
  });
}
