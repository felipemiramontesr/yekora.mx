/**
 * The signed-in account (FC 028): `/v1/account/*`, guarded by the permission `account:self`.
 * The guard in app.ts has already found the session, checked the second factor and the
 * permission, and set `request.user` before these handlers run.
 *
 * - `me` answers who is signed in, with the roles and permissions the interface may show
 *   (143_AN B4: the interface only hides; the API decides).
 * - `logout` ends the session and clears the cookie.
 * - `orders` lists the buyer's own orders, always filtered by the session's user (T2.6b), and
 *   `orders/:order_number` shows one of them; another account's order, or a guest purchase, is
 *   refused with 403 DATA_DOMAIN_FORBIDDEN (T1.2 D). Read-only (T2.6a, routes/orders.ts).
 *
 * @module
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  accountOrdersQuery,
  orderDetailSchema,
  orderPageSchema,
} from '../../../../lib/account/orderTypes';
import { problem, PROBLEM_TYPE } from '../lib/problem';
import { clearedSessionCookie } from '../lib/session';
import { expireOverdueOrders } from '../services/checkout';
import type { Db, Transactional } from '../services/db';
import { closeSession, type SessionUser } from '../services/identity';
import { listOrders } from '../services/orderReads';
import { lookUpOrder } from './orders';

/** Answer of `GET /v1/account/me`. */
export const meResponseSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  fullName: z.string(),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
});

/** Dependencies of the account routes. */
interface AccountDeps {
  /** Database with transactions (lazy expiry of overdue orders). */
  db: Db & Transactional;
  /** Clock. */
  now: () => Date;
}

/**
 * Registers the account routes.
 *
 * @param app - Fastify instance.
 * @param deps - Database and clock.
 */
export function registerAccountRoutes(
  app: FastifyInstance,
  deps: AccountDeps
): void {
  app.get('/v1/account/me', (request, reply) => {
    const user = request.user as SessionUser;
    return reply.send(
      meResponseSchema.parse({
        id: user.userId,
        email: user.email,
        fullName: user.fullName,
        roles: user.roles,
        permissions: user.permissions,
      })
    );
  });

  app.post('/v1/account/logout', async (request, reply) => {
    await closeSession(deps.db, (request.user as SessionUser).sessionId);
    return reply.header('Set-Cookie', clearedSessionCookie()).code(204).send();
  });

  app.get('/v1/account/orders', async (request, reply) => {
    const query = accountOrdersQuery.safeParse(request.query);
    if (!query.success) {
      return reply
        .code(400)
        .type(PROBLEM_TYPE)
        .send(problem(400, 'Invalid query', 'INVALID_REQUEST'));
    }
    // Lapsed reservations read EXPIRED, as on the buyer's return page.
    await expireOverdueOrders(deps.db, deps.now());
    const { items, total } = await listOrders(
      deps.db,
      { userId: (request.user as SessionUser).userId },
      query.data
    );
    return orderPageSchema.parse({ items, total, ...query.data });
  });

  app.get('/v1/account/orders/:order_number', async (request, reply) => {
    const { order_number: orderNumber } = request.params as {
      order_number: string;
    };
    const found = await lookUpOrder(deps, orderNumber);
    if (found === null) {
      return reply.code(404).type(PROBLEM_TYPE).send(problem(404, 'Not found'));
    }
    if (found.ownerId !== (request.user as SessionUser).userId) {
      return reply
        .code(403)
        .type(PROBLEM_TYPE)
        .send(problem(403, 'Not your order', 'DATA_DOMAIN_FORBIDDEN'));
    }
    return orderDetailSchema.parse(found.order);
  });
}
