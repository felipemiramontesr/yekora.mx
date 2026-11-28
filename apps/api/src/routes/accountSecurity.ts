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
 * - The second factor (T1.3, T1.4): optional for an account with no privileged role, mandatory for
 *   the rest. Its secret and backup codes are answered once and never stored as an answer.
 * - `/v1/admin/users/recover-2fa` (T1.5): only the owner, with the code of their own
 *   authenticator, turns off the second factor of a customer who lost it.
 *
 * @module
 */
import { createHmac } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import {
  confirmResponseSchema,
  enrollResponseSchema,
} from '../../../../lib/account/authTypes';
import {
  backupCodesRequestSchema,
  deviceListSchema,
  deviceParams,
  passwordChangeRequestSchema,
  recover2faRequestSchema,
  securityDoneSchema,
  sessionListSchema,
  sessionParams,
  totpDisableRequestSchema,
  totpEnableRequestSchema,
  twoFactorStateSchema,
} from '../../../../lib/account/securityTypes';
import {
  PASSWORD_PROBLEMS,
  passwordViolation,
} from '../../../../lib/account/passwordPolicy';
import type { AuthSecrets } from '../config';
import { isPrivileged } from '../lib/permissions';
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
import {
  base32,
  codeHash,
  decryptTotpSecret,
  encryptTotpSecret,
  newBackupCodes,
  newTotpSecret,
  otpauthUri,
  verifyTotp,
} from '../services/authCrypto';
import type { Db, Transactional, TxQuery } from '../services/db';
import {
  checkIdempotencyKey,
  type MutationAnswer,
  requestHash,
  runIdempotent,
} from '../services/idempotency';
import {
  canonicalEmail,
  capabilitiesOf,
  disableTotp,
  enableTotp,
  findUserByEmail,
  revokeAccess,
  savePendingTotp,
  type SessionUser,
  totpOf,
  useBackupCode,
} from '../services/identity';
import { enqueueMail } from '../services/outbox';
import { hashPassword, verifyPassword } from '../services/passwords';
import type { BreachVerdict } from '../services/pwnedPasswords';
import { verifyStepUpTotp } from '../services/totpStepUp';
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
 * Runs a write whose body carries a secret once per `Idempotency-Key`, recognising a repeated
 * request by a keyed hash of the body: a stored plain digest of a password or a code could be
 * guessed.
 */
async function oncePerKey(
  deps: AccountSecurityDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  asked: { key: string; route: string; body: object },
  work: (tx: TxQuery) => Promise<MutationAnswer>
) {
  // The guard answers 503 before this when the identity secrets are missing.
  const { secret } = deps.auth as AuthSecrets;
  const outcome = await runIdempotent(
    deps.db,
    {
      userId: userOf(request).userId,
      key: asked.key,
      route: asked.route,
      requestHash: requestHash(
        'application/json',
        createHmac('sha256', secret)
          .update(JSON.stringify(asked.body))
          .digest('hex')
      ),
      now: deps.now(),
    },
    work
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
  return oncePerKey(
    deps,
    request,
    reply,
    { key: key.key, route: 'POST /v1/account/password', body: body.data },
    (tx) => applyPassword(tx, deps, request, body.data)
  );
}

/** Starts an enrolment: a new secret, kept pending; never while the second factor is on. */
async function setupTotp(
  deps: AccountSecurityDeps,
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { userId, email } = userOf(request);
  const { totpKey } = deps.auth as AuthSecrets;
  // Saving a pending secret turns the flag off: it must never run over an active one.
  if ((await totpOf(deps.db, userId))?.enabled) {
    return refuse(reply, 409, 'Already on', 'TOTP_ALREADY_ENABLED');
  }
  const secret = newTotpSecret();
  await savePendingTotp(
    deps.db,
    userId,
    encryptTotpSecret(totpKey, userId, secret)
  );
  return enrollResponseSchema.parse({
    secret: base32(secret),
    otpauthUri: otpauthUri(email, secret),
  });
}

/** The hashes of a fresh set of backup codes, with the codes to show this once. */
function freshCodes(auth: AuthSecrets) {
  const codes = newBackupCodes();
  return { codes, hashes: codes.map((code) => codeHash(auth.secret, code)) };
}

/** Turns the pending authenticator on with its code (T1.3), all in one transaction. */
async function enableSecondFactor(
  deps: AccountSecurityDeps,
  request: FastifyRequest,
  reply: FastifyReply
) {
  const body = totpEnableRequestSchema.safeParse(request.body);
  if (!body.success) {
    return refuse(reply, 400, 'Invalid code', 'INVALID_TOTP_CODE');
  }
  const { userId } = userOf(request);
  const auth = deps.auth as AuthSecrets;
  const totp = await totpOf(deps.db, userId);
  if (totp === null) {
    return refuse(reply, 409, 'Start the setup first', 'TOTP_NOT_ENROLLED');
  }
  if (totp.enabled) {
    return refuse(reply, 409, 'Already on', 'TOTP_ALREADY_ENABLED');
  }
  const secret = decryptTotpSecret(auth.totpKey, userId, totp.encrypted);
  if (!verifyTotp(secret, body.data.code, deps.now())) {
    return refuse(reply, 400, 'Invalid code', 'INVALID_TOTP_CODE');
  }
  const { codes, hashes } = freshCodes(auth);
  await deps.db.transaction(async (tx) => {
    await enableTotp(tx, userId, hashes);
    await forgetAllDevices(tx, userId);
    await enqueueMail(tx, { type: 'TOTP_ENABLED', userId });
    await audit(tx, request, 'TOTP_ENROLLED');
  });
  request.outboxQueued = true;
  return confirmResponseSchema.parse({ backupCodes: codes });
}

const wrongPassword = async (
  deps: AccountSecurityDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  action: string
) => {
  await audit(deps.db, request, action);
  return refuse(
    reply,
    400,
    'The current password is not correct',
    'INVALID_CURRENT_PASSWORD'
  );
};

/** Turns the second factor off with the password and a second factor (T1.4). */
async function disableSecondFactor(
  deps: AccountSecurityDeps,
  request: FastifyRequest,
  reply: FastifyReply
) {
  const { userId, roles } = userOf(request);
  if (isPrivileged(roles)) {
    return refuse(
      reply,
      403,
      'The second factor of this account is mandatory',
      'STAFF_TOTP_MANDATORY_REJECT'
    );
  }
  const body = totpDisableRequestSchema.safeParse(request.body);
  if (!body.success) {
    return refuse(reply, 400, 'Invalid request', 'INVALID_REQUEST');
  }
  const auth = deps.auth as AuthSecrets;
  const { password, code } = body.data;
  const stored = await passwordHashOf(deps.db, userId);
  if (!(await verifyPassword(stored, password))) {
    return wrongPassword(deps, request, reply, 'TOTP_DISABLE_REFUSED');
  }
  const totp = await totpOf(deps.db, userId);
  if (!totp?.enabled) {
    return refuse(reply, 409, 'It is not on', 'TOTP_NOT_ENABLED');
  }
  const secret = decryptTotpSecret(auth.totpKey, userId, totp.encrypted);
  // The second factor: six digits of the authenticator, or a backup code spent here.
  const passes = async (tx: TxQuery) =>
    code.length === 6
      ? verifyTotp(secret, code, deps.now())
      : useBackupCode(
          tx as Db,
          userId,
          codeHash(auth.secret, code),
          deps.now()
        );
  const turnOff = async (tx: TxQuery) => {
    await disableTotp(tx, userId);
    await forgetAllDevices(tx, userId);
    await enqueueMail(tx, { type: 'TOTP_DISABLED', userId });
    await audit(tx, request, 'TOTP_DISABLED');
  };
  const done = await deps.db.transaction(async (tx) => {
    const passed = await passes(tx);
    if (passed) await turnOff(tx);
    return passed;
  });
  if (!done) {
    await audit(deps.db, request, 'TOTP_DISABLE_REFUSED');
    return refuse(reply, 400, 'Invalid code', 'INVALID_2FA_CODE');
  }
  request.outboxQueued = true;
  return DONE;
}

/** Replaces the backup codes with eight new ones, shown this once. */
async function regenerateCodes(
  deps: AccountSecurityDeps,
  request: FastifyRequest,
  reply: FastifyReply
) {
  const body = backupCodesRequestSchema.safeParse(request.body);
  if (!body.success) {
    return refuse(reply, 400, 'Invalid request', 'INVALID_REQUEST');
  }
  const { userId } = userOf(request);
  const stored = await passwordHashOf(deps.db, userId);
  if (!(await verifyPassword(stored, body.data.password))) {
    return wrongPassword(deps, request, reply, 'BACKUP_CODES_REFUSED');
  }
  if (!(await totpOf(deps.db, userId))?.enabled) {
    return refuse(reply, 409, 'It is not on', 'TOTP_NOT_ENABLED');
  }
  const { codes, hashes } = freshCodes(deps.auth as AuthSecrets);
  await deps.db.transaction(async (tx) => {
    await enableTotp(tx, userId, hashes);
    await enqueueMail(tx, { type: 'TOTP_BACKUP_CODES_REGENERATED', userId });
    await audit(tx, request, 'BACKUP_CODES_REGENERATED');
  });
  request.outboxQueued = true;
  return confirmResponseSchema.parse({ backupCodes: codes });
}

type Recovery = z.infer<typeof recover2faRequestSchema>;

/**
 * A reason worth keeping in the audit log: at least ten characters, with no e-mail address and no
 * long run of digits (a phone or a card number), which the log must not hold.
 */
const acceptableReason = (reason: string) =>
  reason.length >= 10 && !/@|\d{7}/.test(reason);

/** A refusal of the recovery, as the answer of a mutation. */
const recoveryRefused = (status: number, code: string, title: string) => ({
  status,
  body: problem(status, title, code),
});

/**
 * Judges and applies one recovery (T1.5), in order: the owner's own code and a reason, the account,
 * that it has no privileged role, and that its second factor is on.
 */
async function applyRecovery(
  tx: TxQuery,
  deps: AccountSecurityDeps,
  request: FastifyRequest,
  body: Recovery
) {
  const owner = userOf(request).userId;
  const step = await verifyStepUpTotp(tx, {
    userId: owner,
    code: body.ownerTotpCode,
    totpKey: (deps.auth as AuthSecrets).totpKey,
    now: deps.now(),
  });
  if (step !== 'STEP_UP_GRANTED_200' || !acceptableReason(body.reason)) {
    return recoveryRefused(
      400,
      'INVALID_OWNER_STEPUP_OR_REASON',
      'Your code or the reason is not valid'
    );
  }
  const target = await findUserByEmail(
    tx as Db,
    canonicalEmail(body.targetEmail)
  );
  if (target === null) {
    return recoveryRefused(404, 'USER_NOT_FOUND', 'No such account');
  }
  const { roles } = await capabilitiesOf(tx as Db, target.id);
  if (isPrivileged(roles)) {
    return recoveryRefused(
      400,
      'STAFF_2FA_CANNOT_BE_RECOVERED',
      'The second factor of that account is mandatory'
    );
  }
  if (!(await totpOf(tx, target.id))?.enabled) {
    return recoveryRefused(400, 'TOTP_NOT_ENABLED', 'It is not on');
  }
  await disableTotp(tx, target.id);
  await revokeAccess(tx, target.id);
  await enqueueMail(tx, { type: 'TOTP_RECOVERED', userId: target.id });
  await recordAudit(tx, {
    userId: owner,
    action: 'CUSTOMER_2FA_RESET_BY_OWNER',
    entityType: 'user',
    entityId: target.id,
    before: null,
    after: { reason: body.reason },
    ip: request.ip,
  });
  request.outboxQueued = true;
  return { status: 200, body: DONE };
}

/** The recovery, once per key; what is hashed of it is a keyed hash, not its plain digest. */
async function recoverSecondFactor(
  deps: AccountSecurityDeps,
  request: FastifyRequest,
  reply: FastifyReply
) {
  const key = checkIdempotencyKey(request.headers['idempotency-key']);
  if (key.code !== 'IDEMP_KEY_ACCEPTED') {
    return refuse(reply, 400, 'Idempotency-Key required', key.code);
  }
  const body = recover2faRequestSchema.safeParse(request.body);
  if (!body.success) {
    return refuse(reply, 400, 'Invalid request', 'INVALID_REQUEST');
  }
  return oncePerKey(
    deps,
    request,
    reply,
    {
      key: key.key,
      route: 'POST /v1/admin/users/recover-2fa',
      body: body.data,
    },
    (tx) => applyRecovery(tx, deps, request, body.data)
  );
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

  app.get('/v1/account/2fa', async (request) => {
    const { userId, roles } = userOf(request);
    const totp = await totpOf(deps.db, userId);
    return twoFactorStateSchema.parse({
      enabled: totp?.enabled ?? false,
      mandatory: isPrivileged(roles),
    });
  });
  app.post('/v1/account/2fa/totp/setup', LIMITED, async (request, reply) =>
    setupTotp(deps, request, reply)
  );
  app.post('/v1/account/2fa/totp/enable', LIMITED, async (request, reply) =>
    enableSecondFactor(deps, request, reply)
  );
  app.post('/v1/account/2fa/totp/disable', LIMITED, async (request, reply) =>
    disableSecondFactor(deps, request, reply)
  );
  app.post(
    '/v1/account/2fa/backup-codes/regenerate',
    LIMITED,
    async (request, reply) => regenerateCodes(deps, request, reply)
  );
  app.post('/v1/admin/users/recover-2fa', LIMITED, async (request, reply) =>
    recoverSecondFactor(deps, request, reply)
  );

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
