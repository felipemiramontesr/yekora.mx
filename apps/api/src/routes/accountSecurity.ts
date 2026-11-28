/**
 * The security of the signed-in account (FC 079 F0): `/v1/account/{password,sessions,devices}`,
 * guarded by `account:self`.
 *
 * - The password changes only with the current one, judged in order: identity (T1.1a), then the
 *   rules and the known breaches (T1.1b). The route answers 10 tries a minute from one address and
 *   every wrong current password is audited.
 * - It runs once per `Idempotency-Key`. What is hashed to recognise a repeated request is a keyed
 *   HMAC of the body, never its plain digest: a stored fast hash of a password could be guessed.
 * - Closing sessions and forgetting devices only ever touches the account's own (T2.2).
 *
 * @module
 */
import { createHmac } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import {
  deviceListSchema,
  deviceParams,
  passwordChangeRequestSchema,
  securityDoneSchema,
  sessionListSchema,
  sessionParams,
} from '../../../../lib/account/securityTypes';
import {
  PASSWORD_PROBLEMS,
  passwordViolation,
} from '../../../../lib/account/passwordPolicy';
import type { AuthSecrets } from '../config';
import { problem, PROBLEM_TYPE } from '../lib/problem';
import {
  closeOneSession,
  closeOtherSessions,
  forgetAllDevices,
  forgetOneDevice,
  listDevices,
  listSessions,
  passwordHashOf,
  REVOCATION_REFUSALS,
  type RevocationRefusal,
  storePassword,
} from '../services/accountSecurity';
import { recordAudit } from '../services/audit';
import type { Db, Transactional, TxQuery } from '../services/db';
import {
  checkIdempotencyKey,
  requestHash,
  runIdempotent,
} from '../services/idempotency';
import type { SessionUser } from '../services/identity';
import { enqueueMail } from '../services/outbox';
import { hashPassword, verifyPassword } from '../services/passwords';
import type { BreachVerdict } from '../services/pwnedPasswords';
import { refuse } from './catalogMutation';

type PasswordChange = z.infer<typeof passwordChangeRequestSchema>;

/** Dependencies of the security routes. */
interface AccountSecurityDeps {
  /** Database with transactions. */
  db: Db & Transactional;
  /** Clock. */
  now: () => Date;
  /** The identity secrets, or null when they are not configured (the guard then answers 503). */
  auth: AuthSecrets | null;
  /** Whether a password is in a known breach. */
  breach: (password: string) => Promise<BreachVerdict>;
}

/** T1.1a: the routes that check a password answer 10 requests a minute from one address. */
const LIMITED = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

const userOf = (request: FastifyRequest) => request.user as SessionUser;

/** An audit entry of the account about itself: what happened, never what was typed. */
const audit = (db: TxQuery, request: FastifyRequest, action: string) =>
  recordAudit(db, {
    userId: userOf(request).userId,
    action,
    entityType: 'users',
    entityId: userOf(request).userId,
    before: null,
    after: null,
    ip: request.ip,
  });

const refusalOf = (reply: FastifyReply, code: RevocationRefusal) =>
  refuse(reply, ...REVOCATION_REFUSALS[code], code);

const DONE = securityDoneSchema.parse({ success: true });

/** A refusal of the change of password: nothing was changed, and it is never replayed. */
const refused = (code: string, title: string) => ({
  status: 400,
  body: problem(400, title, code),
});

/**
 * Judges and applies one change of password inside its transaction, in order: the current password
 * (T1.1a, every failure audited), the confirmation, the difference, the rules and the breaches
 * (T1.1b).
 */
async function applyPassword(
  tx: TxQuery,
  deps: AccountSecurityDeps,
  request: FastifyRequest,
  body: PasswordChange
) {
  const { currentPassword, newPassword, confirmPassword } = body;
  const { userId, sessionId, email, fullName } = userOf(request);
  const stored = await passwordHashOf(tx, userId);
  if (!(await verifyPassword(stored, currentPassword))) {
    await audit(tx, request, 'PASSWORD_CHANGE_REFUSED');
    return refused(
      'INVALID_CURRENT_PASSWORD',
      'The current password is not correct'
    );
  }
  if (confirmPassword !== newPassword) {
    return refused(
      'PASSWORD_CONFIRMATION_MISMATCH',
      'The two passwords differ'
    );
  }
  if (newPassword === currentPassword) {
    return refused(
      'PASSWORD_IDENTICAL_TO_CURRENT',
      'The new password is the current one'
    );
  }
  const broken = passwordViolation(newPassword, { email, fullName });
  if (broken !== null) {
    return refused(
      PASSWORD_PROBLEMS[broken],
      'The password is not strong enough'
    );
  }
  if ((await deps.breach(newPassword)) === 'breached') {
    return refused(
      'PASSWORD_BREACHED',
      'The password appears in a known data breach'
    );
  }
  const hash = await hashPassword(newPassword);
  await storePassword(tx, { userId, hash, current: sessionId });
  await enqueueMail(tx, { type: 'PASSWORD_CHANGED', userId });
  await audit(tx, request, 'PASSWORD_CHANGED');
  request.outboxQueued = true;
  return { status: 200, body: DONE };
}

/**
 * The change of password, once per key: a repeated request answers what it answered, without the
 * current password being judged again (after the change it is no longer the current one).
 */
async function changePassword(
  deps: AccountSecurityDeps,
  request: FastifyRequest,
  reply: FastifyReply
) {
  const key = checkIdempotencyKey(request.headers['idempotency-key']);
  if (key.code !== 'IDEMP_KEY_ACCEPTED') {
    return refuse(reply, 400, 'Idempotency-Key required', key.code);
  }
  const body = passwordChangeRequestSchema.safeParse(request.body);
  if (!body.success) {
    return refuse(reply, 400, 'Invalid request', 'INVALID_REQUEST');
  }
  // The guard answers 503 before this when the identity secrets are missing.
  const { secret } = deps.auth as AuthSecrets;
  const outcome = await runIdempotent(
    deps.db,
    {
      userId: userOf(request).userId,
      key: key.key,
      route: 'POST /v1/account/password',
      requestHash: requestHash(
        'application/json',
        createHmac('sha256', secret)
          .update(JSON.stringify(body.data))
          .digest('hex')
      ),
      now: deps.now(),
    },
    (tx) => applyPassword(tx, deps, request, body.data)
  );
  if (outcome.code === 'IDEMP_PAYLOAD_MISMATCH') {
    return refuse(reply, 409, 'Idempotency-Key reused', outcome.code);
  }
  const { status, body: answer } = outcome.answer;
  if (status >= 400) reply.type(PROBLEM_TYPE);
  return reply
    .code(status)
    .header('idempotency-status', outcome.code)
    .send(answer);
}

/**
 * Registers the routes of the security of the account.
 *
 * @param app - Fastify instance.
 * @param deps - Database, clock, identity secrets and the breach check.
 */
export function registerAccountSecurityRoutes(
  app: FastifyInstance,
  deps: AccountSecurityDeps
): void {
  app.post('/v1/account/password', LIMITED, async (request, reply) =>
    changePassword(deps, request, reply)
  );

  app.get('/v1/account/sessions', async (request) => {
    const { userId, sessionId } = userOf(request);
    return sessionListSchema.parse({
      items: await listSessions(deps.db, userId, sessionId, deps.now()),
    });
  });

  app.delete('/v1/account/sessions/:id', async (request, reply) => {
    const params = sessionParams.safeParse(request.params);
    if (!params.success) return refusalOf(reply, 'SESSION_NOT_FOUND');
    const { userId, sessionId } = userOf(request);
    const refused = await deps.db.transaction(async (tx) => {
      const why = await closeOneSession(tx, {
        id: params.data.id,
        userId,
        current: sessionId,
        now: deps.now(),
      });
      if (why === null) await audit(tx, request, 'SESSION_REVOKED');
      return why;
    });
    return refused === null ? DONE : refusalOf(reply, refused);
  });

  app.delete('/v1/account/sessions', async (request) => {
    const { userId, sessionId } = userOf(request);
    await deps.db.transaction(async (tx) => {
      await closeOtherSessions(tx, userId, sessionId);
      await audit(tx, request, 'OTHER_SESSIONS_REVOKED');
    });
    return DONE;
  });

  app.get('/v1/account/devices', async (request) =>
    deviceListSchema.parse({
      items: await listDevices(deps.db, userOf(request).userId, deps.now()),
    })
  );

  app.delete('/v1/account/devices/:id', async (request, reply) => {
    const params = deviceParams.safeParse(request.params);
    if (!params.success) return refusalOf(reply, 'DEVICE_NOT_FOUND');
    const refused = await deps.db.transaction(async (tx) => {
      const why = await forgetOneDevice(
        tx,
        params.data.id,
        userOf(request).userId
      );
      if (why === null) await audit(tx, request, 'DEVICE_FORGOTTEN');
      return why;
    });
    return refused === null ? DONE : refusalOf(reply, refused);
  });

  app.delete('/v1/account/devices', async (request) => {
    await deps.db.transaction(async (tx) => {
      await forgetAllDevices(tx, userOf(request).userId);
      await audit(tx, request, 'DEVICES_FORGOTTEN');
    });
    return DONE;
  });
}
