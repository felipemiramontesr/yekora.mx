/**
 * The administrators console of the owner (FC 044 F1): `/v1/admin/admins`.
 *
 * The guard of app.ts checks the session, the authenticator and `users:manage` first (T1.4 P).
 * `admin` holds that permission too, so each handler then asks for the role `owner` itself
 * (T1.4 O): anyone else gets 403 OWNER_ROLE_REQUIRED. No route here grants or withdraws
 * `owner`, and a write that targets an owner account is refused with 403 OWNER_IMMUTABLE (T2.1).
 *
 * - `GET /v1/admin/admins` lists the owner and administrator accounts.
 * - `POST /v1/admin/admins` (T1.2) grants `admin` to an e-mail: a new account without a
 *   temporary password, or an existing buyer; either receives a 15-minute reset link (T2.2).
 * - `PATCH /v1/admin/admins/:id` (T1.3) switches an administrator on or off, or withdraws the
 *   role, ending its sessions and remembered devices (T2.5).
 * Writes run once per `Idempotency-Key` (FC 029 T1.3), in the order key, role, payload, target.
 *
 * @module
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  adminCreateRequestSchema,
  adminUpdateRequestSchema,
  adminUserListSchema,
  adminUserParams,
} from '../../../../lib/account/adminUserTypes';
import type { AuthSecrets } from '../config';
import { problem } from '../lib/problem';
import {
  type AdminRefusal,
  createAdmin,
  listAdmins,
  updateAdmin,
} from '../services/adminUsers';
import type { Db, Transactional } from '../services/db';
import { canonicalEmail, type SessionUser } from '../services/identity';
import {
  checkIdempotencyKey,
  type MutationAnswer,
} from '../services/idempotency';
import { refuse, runOnce } from './catalogMutation';

/** Dependencies of the administrators console. */
interface AdminUsersDeps {
  /** Database with transactions. */
  db: Db & Transactional;
  /** Identity secrets; the guard answers 503 before these routes when they are missing. */
  auth: AuthSecrets | null;
  /** Clock. */
  now: () => Date;
}

/** Status and title of each refusal of a write. */
const REFUSALS: Readonly<Record<AdminRefusal, readonly [number, string]>> = {
  OWNER_IMMUTABLE: [403, 'The owner account cannot be changed'],
  ADMIN_ALREADY_EXISTS: [409, 'Already an administrator'],
  ADMIN_NOT_FOUND: [404, 'Not found'],
};

/** Whether the signed-in user is the owner. The guard set the user: no route here is public. */
const isOwner = (request: FastifyRequest) =>
  (request.user as SessionUser).roles.includes('owner');

const notOwner = (reply: FastifyReply) =>
  refuse(
    reply,
    403,
    'Only the owner manages administrators',
    'OWNER_ROLE_REQUIRED'
  );

/** The answer of a write: the account with `created` (201) or 200, or its refusal. */
function answerOf(
  outcome: Awaited<ReturnType<typeof createAdmin>>,
  created: boolean
): MutationAnswer {
  if (typeof outcome !== 'string') {
    return { status: created ? 201 : 200, body: outcome };
  }
  const [status, title] = REFUSALS[outcome];
  return { status, body: problem(status, title, outcome) };
}

/**
 * Registers the administrators console.
 *
 * @param app - Fastify instance.
 * @param deps - Database, identity secrets and clock.
 */
export function registerAdminUserRoutes(
  app: FastifyInstance,
  deps: AdminUsersDeps
): void {
  app.get('/v1/admin/admins', async (request, reply) => {
    if (!isOwner(request)) return notOwner(reply);
    return adminUserListSchema.parse({ items: await listAdmins(deps.db) });
  });

  app.post('/v1/admin/admins', async (request, reply) => {
    const key = checkIdempotencyKey(request.headers['idempotency-key']);
    if (key.code !== 'IDEMP_KEY_ACCEPTED') {
      return refuse(reply, 400, 'Idempotency-Key required', key.code);
    }
    if (!isOwner(request)) return notOwner(reply);
    const body = adminCreateRequestSchema.safeParse(request.body);
    if (!body.success) {
      return refuse(reply, 400, 'Invalid request', 'INVALID_REQUEST');
    }
    // The guard answered 503 without the identity secrets.
    const { totpKey } = deps.auth as AuthSecrets;
    const sent = await runOnce(
      deps,
      request,
      reply,
      key.key,
      async (tx, userId) =>
        answerOf(
          await createAdmin(
            tx,
            {
              email: canonicalEmail(body.data.email),
              fullName: body.data.fullName,
              totpKey,
              now: deps.now(),
            },
            { userId, ip: request.ip }
          ),
          true
        )
    );
    // The link's mail is queued: app.ts wakes the dispatcher once the answer has left.
    request.outboxQueued = reply.statusCode === 201;
    return sent;
  });

  app.patch('/v1/admin/admins/:id', async (request, reply) => {
    const key = checkIdempotencyKey(request.headers['idempotency-key']);
    if (key.code !== 'IDEMP_KEY_ACCEPTED') {
      return refuse(reply, 400, 'Idempotency-Key required', key.code);
    }
    if (!isOwner(request)) return notOwner(reply);
    const params = adminUserParams.safeParse(request.params);
    const body = adminUpdateRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return refuse(reply, 400, 'Invalid request', 'INVALID_REQUEST');
    }
    return runOnce(deps, request, reply, key.key, async (tx, userId) =>
      answerOf(
        await updateAdmin(
          tx,
          { id: params.data.id, ...body.data },
          { userId, ip: request.ip }
        ),
        false
      )
    );
  });
}
