/**
 * The shipping console API (FC 061 F1): `/v1/admin/shipping`.
 *
 * The guard of app.ts checks the session, the authenticator and `shipping:manage` first (T2.4:
 * 401, 403 SECOND_FACTOR_REQUIRED, 403 PERMISSION_DENIED). Then:
 *
 * - `GET /v1/admin/shipping` reads the configuration, the catalogs and the rate of each state.
 * - `PUT /v1/admin/shipping/config` (T1.1) sets the active strategy and free shipping.
 * - `PUT /v1/admin/shipping/rules` (T1.2) replaces the rate of the 32 states, atomically.
 * Writes run once per `Idempotency-Key`, in the order key, payload, mutation, and record their
 * `audit_log` entry in the same transaction (T2.3).
 *
 * @module
 */
import type { FastifyInstance } from 'fastify';
import {
  shippingAdminViewSchema,
  shippingConfigRequestSchema,
  shippingRulesRequestSchema,
} from '../../../../lib/account/shippingAdminTypes';
import { problem } from '../lib/problem';
import type { Db, Transactional } from '../services/db';
import {
  checkIdempotencyKey,
  type MutationAnswer,
} from '../services/idempotency';
import {
  readShippingAdmin,
  type ShippingRefusal,
  updateShippingConfig,
  updateShippingRules,
} from '../services/shippingAdmin';
import { refuse, runOnce } from './catalogMutation';

/** Dependencies of the shipping console. */
interface AdminShippingDeps {
  /** Database with transactions. */
  db: Db & Transactional;
  /** Clock. */
  now: () => Date;
}

/** Status and title of each refusal of a write. */
const REFUSALS: Readonly<Record<ShippingRefusal, readonly [number, string]>> = {
  SHIPPING_STRATEGY_UNAVAILABLE: [409, 'The strategy has no active rates'],
  SHIPPING_ZONE_UNKNOWN: [400, 'Unknown state'],
};

/** The answer of a write: the view after it (200), or its refusal. */
function answerOf(
  outcome: Awaited<ReturnType<typeof updateShippingConfig>>
): MutationAnswer {
  if (typeof outcome !== 'string') return { status: 200, body: outcome };
  const [status, title] = REFUSALS[outcome];
  return { status, body: problem(status, title, outcome) };
}

/**
 * Registers the shipping console.
 *
 * @param app - Fastify instance.
 * @param deps - Database and clock.
 */
export function registerAdminShippingRoutes(
  app: FastifyInstance,
  deps: AdminShippingDeps
): void {
  app.get('/v1/admin/shipping', async () =>
    shippingAdminViewSchema.parse(await readShippingAdmin(deps.db))
  );

  app.put('/v1/admin/shipping/config', async (request, reply) => {
    const key = checkIdempotencyKey(request.headers['idempotency-key']);
    if (key.code !== 'IDEMP_KEY_ACCEPTED') {
      return refuse(reply, 400, 'Idempotency-Key required', key.code);
    }
    const body = shippingConfigRequestSchema.safeParse(request.body);
    if (!body.success) {
      return refuse(reply, 400, 'Invalid request', 'INVALID_REQUEST');
    }
    return runOnce(deps, request, reply, key.key, async (tx, userId) =>
      answerOf(
        await updateShippingConfig(tx, body.data, { userId, ip: request.ip })
      )
    );
  });

  app.put('/v1/admin/shipping/rules', async (request, reply) => {
    const key = checkIdempotencyKey(request.headers['idempotency-key']);
    if (key.code !== 'IDEMP_KEY_ACCEPTED') {
      return refuse(reply, 400, 'Idempotency-Key required', key.code);
    }
    const body = shippingRulesRequestSchema.safeParse(request.body);
    if (!body.success) {
      return refuse(reply, 400, 'Invalid request', 'INVALID_REQUEST');
    }
    return runOnce(deps, request, reply, key.key, async (tx, userId) =>
      answerOf(
        await updateShippingRules(tx, body.data, { userId, ip: request.ip })
      )
    );
  });
}
