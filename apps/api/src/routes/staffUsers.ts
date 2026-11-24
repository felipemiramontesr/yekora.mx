/**
 * The staff of the store in the panel (FC 072 F1): `/v1/admin/users`.
 *
 * The guard of app.ts checks the session, the authenticator and `sellers:manage` first, which the
 * owner and the administrator hold. Then the service decides by the hierarchy (services/staffUsers.ts):
 *
 * - `GET /v1/admin/users` lists the staff the actor may see: the owner all of it, an administrator
 *   only the accounts whose roles an administrator may give (T2.2).
 * - `POST /v1/admin/users` brings a person into the staff with its roles and a 15-minute link, no
 *   password (T2.4).
 * - `PATCH /v1/admin/users/:id` switches an account on or off or replaces its roles, ending its
 *   sessions and remembered devices (T2.3). The owner is never reached (T2.1).
 * Writes run once per `Idempotency-Key` (FC 029 T1.3), in the order key, payload, hierarchy.
 *
 * @module
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  adminUserListSchema,
  adminUserParams,
} from '../../../../lib/account/adminUserTypes';
import {
  staffCreateRequestSchema,
  staffUpdateRequestSchema,
} from '../../../../lib/account/staffTypes';
import type { AuthSecrets } from '../config';
import { problem } from '../lib/problem';
import type { Db, Transactional } from '../services/db';
import { canonicalEmail, type SessionUser } from '../services/identity';
import {
  checkIdempotencyKey,
  type MutationAnswer,
} from '../services/idempotency';
import {
  createStaff,
  listStaff,
  type StaffRefusal,
  updateStaff,
} from '../services/staffUsers';
import { refuse, runOnce } from './catalogMutation';

/** Dependencies of the staff routes. */
interface StaffUsersDeps {
  /** Database with transactions. */
  db: Db & Transactional;
  /** Identity secrets; the guard answers 503 before these routes when they are missing. */
  auth: AuthSecrets | null;
  /** Clock. */
  now: () => Date;
}

/** Status and title of each refusal of a write. */
const REFUSALS: Readonly<Record<StaffRefusal, readonly [number, string]>> = {
  ACTOR_UNAUTHORIZED: [
    403,
    'Only the owner and the administrators manage the staff',
  ],
  TARGET_ROLE_FORBIDDEN: [403, 'That role cannot be given here'],
  ADMIN_CANNOT_ELEVATE_ADMIN: [
    403,
    'An administrator cannot reach that account or role',
  ],
  OWNER_IMMUTABLE: [403, 'The owner account cannot be changed'],
  VALIDATION_OR_2FA_FAILED: [
    400,
    'The request or the second factor is not valid',
  ],
  USER_NOT_FOUND: [404, 'Not found'],
  ROLE_NOT_FOUND: [422, 'Unknown or retired role'],
  STAFF_ALREADY_EXISTS: [409, 'Already part of the staff'],
};

/** The session user as the hierarchy reads it; the guard set it, so no route here is public. */
function actorOf(request: FastifyRequest) {
  const user = request.user as SessionUser;
  return {
    userId: user.userId,
    roles: user.roles,
    totpEnabled: user.totpEnabled,
    ip: request.ip,
  };
}

/** The answer of a write: the account (201 or 200), or its refusal. */
function answerOf(
  outcome: Awaited<ReturnType<typeof createStaff>>,
  created: boolean
): MutationAnswer {
  if (typeof outcome !== 'string') {
    return { status: created ? 201 : 200, body: outcome };
  }
  const [status, title] = REFUSALS[outcome];
  return { status, body: problem(status, title, outcome) };
}

/**
 * Registers the staff routes.
 *
 * @param app - Fastify instance.
 * @param deps - Database, identity secrets and clock.
 */
export function registerStaffUserRoutes(
  app: FastifyInstance,
  deps: StaffUsersDeps
): void {
  app.get('/v1/admin/users', async (request) =>
    adminUserListSchema.parse({
      items: await listStaff(
        deps.db,
        (request.user as SessionUser).roles.includes('owner')
      ),
    })
  );

  app.post('/v1/admin/users', async (request, reply) => {
    const key = checkIdempotencyKey(request.headers['idempotency-key']);
    if (key.code !== 'IDEMP_KEY_ACCEPTED') {
      return refuse(reply, 400, 'Idempotency-Key required', key.code);
    }
    const body = staffCreateRequestSchema.safeParse(request.body);
    if (!body.success) {
      return refuse(reply, 400, 'Invalid request', 'INVALID_REQUEST');
    }
    // The guard answered 503 without the identity secrets.
    const { totpKey } = deps.auth as AuthSecrets;
    const sent = await runOnce(deps, request, reply, key.key, async (tx) =>
      answerOf(
        await createStaff(
          tx,
          {
            email: canonicalEmail(body.data.email),
            fullName: body.data.fullName,
            roles: body.data.roles,
            totpKey,
            now: deps.now(),
          },
          actorOf(request)
        ),
        true
      )
    );
    // The link's mail is queued: app.ts wakes the dispatcher once the answer has left.
    request.outboxQueued = reply.statusCode === 201;
    return sent;
  });

  app.patch('/v1/admin/users/:id', async (request, reply) => {
    const key = checkIdempotencyKey(request.headers['idempotency-key']);
    if (key.code !== 'IDEMP_KEY_ACCEPTED') {
      return refuse(reply, 400, 'Idempotency-Key required', key.code);
    }
    const params = adminUserParams.safeParse(request.params);
    const body = staffUpdateRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return refuse(reply, 400, 'Invalid request', 'INVALID_REQUEST');
    }
    return runOnce(deps, request, reply, key.key, async (tx) =>
      answerOf(
        await updateStaff(
          tx,
          { id: params.data.id, ...body.data },
          actorOf(request)
        ),
        false
      )
    );
  });
}
