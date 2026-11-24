/**
 * The roles and the matrix of permissions in the panel (FC 072 F1): `/v1/admin/roles`.
 *
 * - `GET /v1/admin/roles` (`sellers:manage`, the owner and the administrator) lists the roles with
 *   their permissions and the catalog the matrix is made of.
 * - `POST /v1/admin/roles` and `PATCH /v1/admin/roles/:id` (`roles:manage`) create a role of
 *   support and edit a role and its matrix. Only the owner reaches them, and never a role of the
 *   system (T1.2); the matrix keeps the invariants of T2.7 (services/adminRoles.ts).
 * Writes run once per `Idempotency-Key` (FC 029 T1.3), in the order key, payload, rule of the owner.
 * The second factor is the one of the session, which the guard already demands.
 *
 * @module
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  roleCreateRequestSchema,
  roleListSchema,
  roleParams,
  rolePatchRequestSchema,
} from '../../../../lib/account/staffTypes';
import { problem } from '../lib/problem';
import {
  createRole,
  listRoles,
  patchRole,
  type RoleRefusal,
} from '../services/adminRoles';
import type { Db, Transactional } from '../services/db';
import type { SessionUser } from '../services/identity';
import {
  checkIdempotencyKey,
  type MutationAnswer,
} from '../services/idempotency';
import { refuse, runOnce } from './catalogMutation';

/** Dependencies of the roles routes. */
interface AdminRolesDeps {
  /** Database with transactions. */
  db: Db & Transactional;
  /** Clock. */
  now: () => Date;
}

/** Status and title of each refusal of a write. */
const REFUSALS: Readonly<Record<RoleRefusal, readonly [number, string]>> = {
  OWNER_ONLY_FORBIDDEN: [403, 'Only the owner edits the roles'],
  SYSTEM_ROLE_PROTECTED: [403, 'A role of the system cannot be edited'],
  TWO_FACTOR_REQUIRED: [403, 'The second factor is required'],
  ROLE_NOT_FOUND: [404, 'Not found'],
  ROLE_ALREADY_EXISTS: [409, 'That role already exists'],
  ROLE_ID_RESERVED: [409, 'That slug belongs to the system'],
  MATRIX_INVARIANT_VIOLATED: [
    400,
    'The matrix breaks a rule of the permissions',
  ],
  ROLE_INVARIANT_VIOLATED: [
    400,
    'The administrator role cannot be changed that way',
  ],
};

/** The session user as the rule of the owner reads it; the guard set it, so no route here is public. */
function actorOf(request: FastifyRequest) {
  const user = request.user as SessionUser;
  return {
    userId: user.userId,
    roles: user.roles,
    permissions: user.permissions,
    totpEnabled: user.totpEnabled,
    ip: request.ip,
  };
}

/** The answer of a write: the role (201 or 200), or its refusal. */
function answerOf(
  outcome: Awaited<ReturnType<typeof createRole>>,
  created: boolean
): MutationAnswer {
  if (typeof outcome !== 'string') {
    return { status: created ? 201 : 200, body: outcome };
  }
  const [status, title] = REFUSALS[outcome];
  return { status, body: problem(status, title, outcome) };
}

/**
 * Registers the roles routes.
 *
 * @param app - Fastify instance.
 * @param deps - Database and clock.
 */
export function registerAdminRoleRoutes(
  app: FastifyInstance,
  deps: AdminRolesDeps
): void {
  app.get('/v1/admin/roles', async () =>
    roleListSchema.parse(await listRoles(deps.db))
  );

  app.post('/v1/admin/roles', async (request, reply) => {
    const key = checkIdempotencyKey(request.headers['idempotency-key']);
    if (key.code !== 'IDEMP_KEY_ACCEPTED') {
      return refuse(reply, 400, 'Idempotency-Key required', key.code);
    }
    const body = roleCreateRequestSchema.safeParse(request.body);
    if (!body.success) {
      return refuse(reply, 400, 'Invalid request', 'INVALID_REQUEST');
    }
    return runOnce(deps, request, reply, key.key, async (tx) =>
      answerOf(await createRole(tx, body.data, actorOf(request)), true)
    );
  });

  app.patch('/v1/admin/roles/:id', async (request, reply) => {
    const key = checkIdempotencyKey(request.headers['idempotency-key']);
    if (key.code !== 'IDEMP_KEY_ACCEPTED') {
      return refuse(reply, 400, 'Idempotency-Key required', key.code);
    }
    const params = roleParams.safeParse(request.params);
    const body = rolePatchRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return refuse(reply, 400, 'Invalid request', 'INVALID_REQUEST');
    }
    return runOnce(deps, request, reply, key.key, async (tx) =>
      answerOf(
        await patchRole(tx, params.data.id, body.data, actorOf(request)),
        false
      )
    );
  });
}
