/**
 * The permission guard (FC 028 T2.1a, T2.3, ADR 0011 §3): a Fastify pre-handler that app.ts puts
 * in front of every route its contract does not declare public. The API is the security
 * boundary (143_AN B4); the browser only hides what the answer already refuses.
 *
 * - No identity secrets configured → 503 AUTH_UNAVAILABLE (closed, never half-open).
 * - No live session (absent, revoked or expired) → 401 SESSION_INVALID_OR_EXPIRED (T1.2 S).
 * - Staff or admin without TOTP → 403 SECOND_FACTOR_REQUIRED.
 * - Missing the route's permission → 403 PERMISSION_DENIED (T1.2 P).
 * Otherwise the user is set on `request.user` for the handler.
 *
 * @module
 */
import type { preHandlerAsyncHookHandler } from 'fastify';
import type { AuthSecrets } from '../config';
import type { Db } from '../services/db';
import { secondFactorSatisfied, sessionUser } from '../services/identity';
import { problem, PROBLEM_TYPE } from './problem';
import { readSessionToken } from './session';

const TITLES = {
  AUTH_UNAVAILABLE: 'Sign-in unavailable',
  SESSION_INVALID_OR_EXPIRED: 'Sign in first',
  SECOND_FACTOR_REQUIRED: 'Two-step verification required',
  PERMISSION_DENIED: 'Not allowed',
} as const;

/**
 * Builds the guard factory for one application.
 *
 * @param deps - Database, identity secrets (null when not configured) and clock.
 * @returns A function that makes the pre-handler of one permission.
 */
export function permissionGuard(deps: {
  db: Db;
  auth: AuthSecrets | null;
  now: () => Date;
}): (permission: string) => preHandlerAsyncHookHandler {
  return (permission) => async (request, reply) => {
    const refuse = (status: number, code: keyof typeof TITLES) =>
      reply
        .code(status)
        .type(PROBLEM_TYPE)
        .send(problem(status, TITLES[code], code));
    if (deps.auth === null) return refuse(503, 'AUTH_UNAVAILABLE');
    const token = readSessionToken(request.headers.cookie);
    const user = token ? await sessionUser(deps.db, token, deps.now()) : null;
    if (user === null) return refuse(401, 'SESSION_INVALID_OR_EXPIRED');
    if (!secondFactorSatisfied(user))
      return refuse(403, 'SECOND_FACTOR_REQUIRED');
    if (!user.permissions.includes(permission))
      return refuse(403, 'PERMISSION_DENIED');
    request.user = user;
  };
}
