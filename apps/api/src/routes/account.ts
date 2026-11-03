/**
 * The signed-in account (FC 028 F0): `/v1/account/*`, guarded by the permission `account:self`.
 * The guard in app.ts has already found the session, checked the second factor and the
 * permission, and set `request.user` before these handlers run.
 *
 * - `me` answers who is signed in, with the roles and permissions the interface may show
 *   (143_AN B4: the interface only hides; the API decides).
 * - `logout` ends the session and clears the cookie.
 *
 * @module
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { clearedSessionCookie } from '../lib/session';
import type { Db } from '../services/db';
import { closeSession, type SessionUser } from '../services/identity';

/** Answer of `GET /v1/account/me`. */
export const meResponseSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  fullName: z.string(),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
});

/**
 * Registers the account routes.
 *
 * @param app - Fastify instance.
 * @param deps - Database port.
 */
export function registerAccountRoutes(
  app: FastifyInstance,
  deps: { db: Db }
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
}
