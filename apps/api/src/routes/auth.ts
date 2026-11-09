/**
 * Sign-up and sign-in (FC 028, 143_AN B2): `/v1/auth/*`, public by nature, rate limited.
 *
 * - `register` never says whether an e-mail already had an account (202 either way).
 * - `login` checks the password (an unknown e-mail costs the same Argon2id work) and opens a
 *   5-minute challenge; it never opens a session. `channel` tells where the code comes from:
 *   the authenticator when it is on, otherwise a 6-digit code mailed through the outbox.
 * - `verify` takes that code: the mailed one, or an authenticator or backup code. A buyer is then
 *   signed in. Staff and admin who proved their mailbox but have no authenticator yet get 409
 *   TOTP_NOT_ENROLLED (T2.1a), and their challenge moves on to `totp/enroll`.
 * - `totp/enroll` and `totp/confirm` turn the authenticator on, only after the mailbox was
 *   proved; confirming issues the 8 backup codes, shown once, queues a security alert in the
 *   same transaction (T2.4b) and opens the session.
 * - `bot-challenge` (Enmienda 1, E1) hands out a proof-of-work challenge. `register` and `login`
 *   check its solution (`altcha`) before anything else: without a valid, unspent one no password
 *   is checked and no mail is queued (T2.8a), and the answer is 400 BOT_CHALLENGE_REQUIRED or
 *   BOT_CHALLENGE_FAILED (T1.4).
 * - A buyer may ask `verify` to remember the device for 30 days (E2). On that device `login` then
 *   answers 201 signed in after the password alone. Never for staff or admin (T2.9b).
 * - FC 042: every new password (`register`, `reset-password`) follows the policy of
 *   lib/account/passwordPolicy (T2.6): a broken rule is a 400 whose detail names it.
 * - `forgot-password` (T1.1, T2.1) answers the same 200, in the same least time, whether the
 *   e-mail has an account or not; only for an active account it opens a 15-minute link and queues
 *   its mail in one transaction. Besides the 10 per minute per IP, each e-mail gets 10 per minute.
 * - `reset-password/check` (Enmienda 2, T1.5) names the account of a live link (e-mail and name)
 *   without spending it, so the form checks the `personal` rule; 400 RESET_TOKEN_INVALID else.
 * - `reset-password` (T1.2, T2.3) takes the link's token and the new password: it spends the
 *   link, ends every session of the account and queues the confirmation mail.
 * - Enmienda 2: a new password the 7 rules accept is then looked up in the Pwned Passwords range
 *   (400 PASSWORD_BREACHED when seen); with no valid range it is accepted (fail-open, by Ω).
 * A wrong code counts against the challenge (5 at most). Without AUTH_SECRET and
 * TOTP_ENCRYPTION_KEY every route answers 503; without the SMTP account, a sign-in that needs the
 * mailed code answers 503 MAIL_UNAVAILABLE.
 *
 * The /v1 contract is published, so the mailed code arrived without breaking it (FC 027 Q03):
 * `login` gained a property and `verify` answers with the 409 it already declared. Enmienda 1
 * adds only optional body fields, a new status (201) and new routes.
 *
 * @module
 */
import { setTimeout as sleep } from 'node:timers/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import {
  challengeRequestSchema,
  codeRequestSchema,
  confirmResponseSchema,
  enrollResponseSchema,
  forgotPasswordRequestSchema,
  forgotPasswordResponseSchema,
  loginRequestSchema,
  loginResponseSchema,
  registeredSchema,
  registerRequestSchema,
  resetCheckRequestSchema,
  resetCheckResponseSchema,
  resetPasswordRequestSchema,
  resetPasswordResponseSchema,
  signedInSchema,
  verifyRequestSchema,
} from '../../../../lib/account/authTypes';
import {
  PASSWORD_PROBLEMS,
  type PasswordContext,
  passwordViolation,
} from '../../../../lib/account/passwordPolicy';
import type { AuthSecrets } from '../config';
import { problem, PROBLEM_TYPE } from '../lib/problem';
import { isPrivileged } from '../lib/permissions';
import {
  clearedSessionCookie,
  deviceCookie,
  readDeviceToken,
  sessionCookie,
} from '../lib/session';
import {
  base32,
  codeHash,
  decryptTotpSecret,
  encryptTotpSecret,
  newBackupCodes,
  newEmailCode,
  newTotpSecret,
  otpauthUri,
  sameHash,
  tokenHash,
  verifyTotp,
} from '../services/authCrypto';
import { checkChallenge, issueChallenge } from '../services/botChallenge';
import type { Db, Transactional } from '../services/db';
import {
  canonicalEmail,
  capabilitiesOf,
  type Challenge,
  clientFacts,
  createCustomer,
  emailOf,
  enableTotp,
  failChallenge,
  findUserByEmail,
  liveChallenge,
  markEmailVerified,
  openChallenge,
  openSession,
  passEmailChallenge,
  savePendingTotp,
  totpOf,
  useBackupCode,
} from '../services/identity';
import { enqueueMail } from '../services/outbox';
import {
  completeReset,
  decoyReset,
  liveReset,
  openReset,
} from '../services/passwordResets';
import { decoyHash, hashPassword, verifyPassword } from '../services/passwords';
import type { BreachVerdict } from '../services/pwnedPasswords';
import { isTrustedDevice, rememberDevice } from '../services/trustedDevices';

/** Dependencies of the auth routes. */
interface AuthDeps {
  db: Db & Transactional;
  auth: AuthSecrets | null;
  /** Whether the outbox can mail (an SMTP account is configured). */
  mailReady: boolean;
  now: () => Date;
  /** For tests: the pause that evens out the time of `forgot-password` (setTimeout by default). */
  wait?: (ms: number) => Promise<void>;
  /** FC 042 Enmienda 2: the breach range's verdict on a new password (services/pwnedPasswords). */
  breach: (password: string) => Promise<BreachVerdict>;
}

/**
 * Least time `forgot-password` takes (T2.1): with or without an account the answer leaves after
 * this, so its timing never tells them apart.
 */
const RESET_REQUEST_FLOOR_MS = 500;
/** Per e-mail, at most this many `forgot-password` per {@link RESET_WINDOW_MS} (T1.1 R). */
const RESET_REQUESTS_PER_EMAIL = 10;
/** The window of {@link RESET_REQUESTS_PER_EMAIL}: one minute. */
const RESET_WINDOW_MS = 60_000;
/** The answer of `forgot-password`, identical for every e-mail (T2.1). */
const RESET_REQUEST_ANSWER = {
  ok: true,
  message:
    'Si el correo está registrado, enviamos instrucciones para restablecer tu contraseña.',
} as const;

const TITLES: Record<string, string> = {
  AUTH_UNAVAILABLE: 'Sign-in unavailable',
  MAIL_UNAVAILABLE: 'Sign-in by e-mail unavailable',
  INVALID_REQUEST: 'Invalid request',
  INVALID_CREDENTIALS: 'Invalid e-mail or password',
  INVALID_CHALLENGE: 'Sign-in expired, start again',
  INVALID_CODE: 'Invalid code',
  TOTP_ALREADY_ENABLED: 'Authenticator already enabled',
  TOTP_NOT_ENROLLED: 'Set up the authenticator first',
  BOT_CHALLENGE_REQUIRED: 'Anti-bot check required',
  BOT_CHALLENGE_FAILED: 'Anti-bot check failed',
  RATE_LIMITED: 'Too many requests, try again in a minute',
  RESET_TOKEN_INVALID: 'Reset link expired or already used',
  PASSWORD_LENGTH: 'The password needs 12 to 128 characters',
  PASSWORD_UPPERCASE: 'The password needs an upper-case letter',
  PASSWORD_LOWERCASE: 'The password needs a lower-case letter',
  PASSWORD_DIGIT: 'The password needs a digit',
  PASSWORD_SYMBOL: 'The password needs a symbol',
  PASSWORD_PERSONAL: 'The password must not contain your e-mail or name',
  PASSWORD_COMMON: 'The password is too common',
  PASSWORD_BREACHED: 'The password appears in a known data breach',
};

/** An RFC 7807 refusal whose detail is its machine code. */
function refuse(reply: FastifyReply, status: number, code: string) {
  return reply
    .code(status)
    .type(PROBLEM_TYPE)
    .send(problem(status, TITLES[code], code));
}

/**
 * FC 042 T2.6: a new password that breaks the policy is a 400 naming the rule, and false. Only a
 * password the 7 rules accept goes to the breach range (Enmienda 2): `breached` is a 400
 * PASSWORD_BREACHED, and `unknown` (no valid range) is the fail-open Ω accepted.
 */
async function strongEnough(
  password: string,
  context: PasswordContext,
  reply: FastifyReply,
  breach: AuthDeps['breach']
): Promise<boolean> {
  const broken = passwordViolation(password, context);
  if (broken !== null) {
    void refuse(reply, 400, PASSWORD_PROBLEMS[broken]);
    return false;
  }
  if ((await breach(password)) !== 'breached') return true;
  void refuse(reply, 400, 'PASSWORD_BREACHED');
  return false;
}

const LIMITED = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };
/** T2.8e: the challenge endpoint, 30 per minute per IP. */
const CHALLENGE_LIMIT = {
  config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
};

/**
 * Registers the sign-up and sign-in routes.
 *
 * @param app - Fastify instance.
 * @param deps - Database, identity secrets, mail readiness and clock.
 */
export function registerAuthRoutes(app: FastifyInstance, deps: AuthDeps): void {
  /** Parses a body, or answers 503 / 400 and returns null. */
  function parse<T>(
    schema: z.ZodType<T>,
    request: FastifyRequest,
    reply: FastifyReply
  ): { auth: AuthSecrets; body: T } | null {
    if (deps.auth === null) {
      void refuse(reply, 503, 'AUTH_UNAVAILABLE');
      return null;
    }
    const body = schema.safeParse(request.body);
    if (!body.success) {
      void refuse(reply, 400, 'INVALID_REQUEST');
      return null;
    }
    return { auth: deps.auth, body: body.data };
  }

  /** The live challenge of a body, of a kind the route accepts, or a 401 and null. */
  async function challengeOf(
    challengeId: string,
    types: readonly Challenge['type'][],
    reply: FastifyReply
  ): Promise<Challenge | null> {
    const challenge = await liveChallenge(deps.db, challengeId, deps.now());
    if (challenge && types.includes(challenge.type)) return challenge;
    void refuse(reply, 401, 'INVALID_CHALLENGE');
    return null;
  }

  /**
   * Checks a mailed code. A buyer is signed in; staff and admin, who must still enrol the
   * authenticator, get 409 TOTP_NOT_ENROLLED and keep the challenge for `totp/enroll`.
   */
  async function passMailedCode(
    request: FastifyRequest,
    reply: FastifyReply,
    auth: AuthSecrets,
    challenge: Challenge,
    code: string,
    remember: boolean
  ) {
    if (!sameHash(challenge.codeHash, codeHash(auth.secret, code))) {
      await failChallenge(deps.db, challenge.id);
      return refuse(reply, 401, 'INVALID_CODE');
    }
    await markEmailVerified(deps.db, challenge.userId, deps.now());
    const { roles } = await capabilitiesOf(deps.db, challenge.userId);
    if (isPrivileged(roles)) {
      await passEmailChallenge(deps.db, auth.secret, challenge.id);
      return refuse(reply, 409, 'TOTP_NOT_ENROLLED');
    }
    await signIn(request, reply, challenge, roles, remember);
    return signedInSchema.parse({ status: 'signed_in' });
  }

  /**
   * Opens the session of a passed challenge (or of a trusted device: no challenge) and sets the
   * cookie; for a buyer who asked, also remembers the device for 30 days (E2, never staff).
   */
  async function signIn(
    request: FastifyRequest,
    reply: FastifyReply,
    passed: { id: string | null; userId: string },
    roles: readonly string[],
    remember = false
  ): Promise<void> {
    const privileged = isPrivileged(roles);
    const facts = clientFacts(request.ip, request.headers['user-agent']);
    const cookies = await deps.db.transaction(async (tx) => {
      const { token, maxAgeSeconds } = await openSession(tx, {
        challengeId: passed.id,
        userId: passed.userId,
        privileged,
        ...facts,
        now: deps.now(),
      });
      const session = sessionCookie(token, maxAgeSeconds);
      if (!remember || privileged) return [session];
      const device = await rememberDevice(tx, {
        userId: passed.userId,
        ...facts,
        now: deps.now(),
      });
      return [session, deviceCookie(device)];
    });
    reply.header('Set-Cookie', cookies);
  }

  /** T1.4: the anti-bot check of a body, or a 400 and false. */
  async function botCheck(
    auth: AuthSecrets,
    altcha: string | undefined,
    reply: FastifyReply
  ): Promise<boolean> {
    const outcome = await checkChallenge(
      deps.db,
      auth.secret,
      altcha,
      deps.now()
    );
    if (outcome === 'passed') return true;
    void refuse(reply, 400, outcome);
    return false;
  }

  const wait = deps.wait ?? sleep;
  /** When each e-mail (by its SHA-256) asked for a reset link, inside the window. */
  const resetRequests = new Map<string, number[]>();

  /** T1.1 R: whether this e-mail may ask for one more link now; counts the request when it may. */
  function underEmailLimit(email: string, at: number): boolean {
    for (const [key, times] of resetRequests) {
      if (times.every((time) => at - time >= RESET_WINDOW_MS)) {
        resetRequests.delete(key);
      }
    }
    const key = tokenHash(email);
    const recent = (resetRequests.get(key) ?? []).filter(
      (time) => at - time < RESET_WINDOW_MS
    );
    if (recent.length >= RESET_REQUESTS_PER_EMAIL) return false;
    resetRequests.set(key, [...recent, at]);
    return true;
  }

  app.get(
    '/v1/auth/bot-challenge',
    CHALLENGE_LIMIT,
    async (_request, reply) => {
      if (deps.auth === null) return refuse(reply, 503, 'AUTH_UNAVAILABLE');
      reply.header('Cache-Control', 'no-store');
      return issueChallenge(deps.auth.secret, deps.now());
    }
  );

  app.post('/v1/auth/register', LIMITED, async (request, reply) => {
    const parsed = parse(registerRequestSchema, request, reply);
    if (parsed === null) return reply;
    const { auth, body } = parsed;
    if (!(await botCheck(auth, body.altcha, reply))) return reply;
    if (!(await strongEnough(body.password, body, reply, deps.breach))) {
      return reply;
    }
    await createCustomer(deps.db, {
      email: canonicalEmail(body.email),
      passwordHash: await hashPassword(body.password),
      fullName: body.fullName,
    });
    return reply.code(202).send(registeredSchema.parse({ status: 'accepted' }));
  });

  app.post('/v1/auth/forgot-password', LIMITED, async (request, reply) => {
    const started = deps.now().getTime();
    const parsed = parse(forgotPasswordRequestSchema, request, reply);
    if (parsed === null) return reply;
    const { auth, body } = parsed;
    if (!(await botCheck(auth, body.altcha, reply))) return reply;
    const email = canonicalEmail(body.email);
    if (!underEmailLimit(email, started)) {
      return refuse(reply, 429, 'RATE_LIMITED');
    }
    if (!deps.mailReady) return refuse(reply, 503, 'MAIL_UNAVAILABLE');
    const user = await findUserByEmail(deps.db, email);
    if (user) {
      // The link and its mail commit together, or neither does (T2.4).
      await deps.db.transaction(async (tx) => {
        const token = await openReset(tx, user.id, deps.now());
        await enqueueMail(tx, {
          type: 'PASSWORD_RESET',
          userId: user.id,
          token: encryptTotpSecret(
            auth.totpKey,
            user.id,
            Buffer.from(token, 'utf8')
          ),
        });
      });
      request.outboxQueued = true;
    } else {
      // T2.1: the same token, hash and encryption, thrown away instead of stored.
      decoyReset(auth.totpKey);
    }
    // T2.1: the same answer after the same least time, with or without an account.
    const elapsed = deps.now().getTime() - started;
    await wait(Math.max(0, RESET_REQUEST_FLOOR_MS - elapsed));
    return forgotPasswordResponseSchema.parse(RESET_REQUEST_ANSWER);
  });

  app.post('/v1/auth/reset-password/check', LIMITED, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const parsed = parse(resetCheckRequestSchema, request, reply);
    if (parsed === null) return reply;
    // T1.5: read, never spent; only the holder of a live link learns whose account it is.
    const reset = await liveReset(deps.db, parsed.body.token, deps.now());
    if (reset === null) return refuse(reply, 400, 'RESET_TOKEN_INVALID');
    return resetCheckResponseSchema.parse({
      email: reset.email,
      fullName: reset.fullName,
    });
  });

  app.post('/v1/auth/reset-password', LIMITED, async (request, reply) => {
    const parsed = parse(resetPasswordRequestSchema, request, reply);
    if (parsed === null) return reply;
    const { body } = parsed;
    const reset = await liveReset(deps.db, body.token, deps.now());
    if (reset === null) return refuse(reply, 400, 'RESET_TOKEN_INVALID');
    if (!(await strongEnough(body.password, reset, reply, deps.breach))) {
      return reply;
    }
    const changed = await completeReset(
      deps.db,
      reset,
      await hashPassword(body.password),
      deps.now(),
      clientFacts(request.ip, undefined).ip
    );
    if (!changed) return refuse(reply, 400, 'RESET_TOKEN_INVALID');
    request.outboxQueued = true;
    return reply
      .header('Set-Cookie', clearedSessionCookie())
      .send(resetPasswordResponseSchema.parse({ ok: true }));
  });

  app.post('/v1/auth/login', LIMITED, async (request, reply) => {
    const parsed = parse(loginRequestSchema, request, reply);
    if (parsed === null) return reply;
    const { auth, body } = parsed;
    if (!(await botCheck(auth, body.altcha, reply))) return reply;
    const user = await findUserByEmail(deps.db, canonicalEmail(body.email));
    // Always one Argon2id verification, against the decoy when the e-mail is unknown.
    const valid = await verifyPassword(
      user?.password_hash ?? (await decoyHash()),
      body.password
    );
    if (user === null || !valid) {
      return refuse(reply, 401, 'INVALID_CREDENTIALS');
    }
    // E2 (T1.1 T): a buyer's live trusted device stands in for the second factor.
    const device = readDeviceToken(request.headers.cookie);
    if (device !== null) {
      const { roles } = await capabilitiesOf(deps.db, user.id);
      const trusted =
        !isPrivileged(roles) &&
        (await isTrustedDevice(deps.db, device, user.id, deps.now()));
      if (trusted) {
        await signIn(request, reply, { id: null, userId: user.id }, roles);
        return reply
          .code(201)
          .send(signedInSchema.parse({ status: 'signed_in' }));
      }
    }
    if ((await totpOf(deps.db, user.id))?.enabled) {
      const challengeId = await openChallenge(
        deps.db,
        auth.secret,
        user.id,
        deps.now()
      );
      return loginResponseSchema.parse({
        challengeId,
        next: 'verify',
        channel: 'authenticator',
      });
    }
    if (!deps.mailReady) return refuse(reply, 503, 'MAIL_UNAVAILABLE');
    // The challenge and its mail commit together, or neither does (T2.4b).
    const code = newEmailCode();
    const challengeId = await deps.db.transaction(async (tx) => {
      const id = await openChallenge(
        tx,
        auth.secret,
        user.id,
        deps.now(),
        code
      );
      await enqueueMail(tx, {
        type: 'SIGN_IN_CODE',
        userId: user.id,
        challengeId: id,
        code: encryptTotpSecret(auth.totpKey, id, Buffer.from(code, 'utf8')),
      });
      return id;
    });
    request.outboxQueued = true;
    return loginResponseSchema.parse({
      challengeId,
      next: 'verify',
      channel: 'email',
    });
  });

  app.post('/v1/auth/totp/enroll', LIMITED, async (request, reply) => {
    const parsed = parse(challengeRequestSchema, request, reply);
    if (parsed === null) return reply;
    const { auth, body } = parsed;
    const challenge = await challengeOf(body.challengeId, ['TOTP'], reply);
    if (challenge === null) return reply;
    if ((await totpOf(deps.db, challenge.userId))?.enabled) {
      return refuse(reply, 409, 'TOTP_ALREADY_ENABLED');
    }
    const email = await emailOf(deps.db, challenge.userId);
    const secret = newTotpSecret();
    await savePendingTotp(
      deps.db,
      challenge.userId,
      encryptTotpSecret(auth.totpKey, challenge.userId, secret)
    );
    return enrollResponseSchema.parse({
      secret: base32(secret),
      otpauthUri: otpauthUri(email, secret),
    });
  });

  app.post('/v1/auth/totp/confirm', LIMITED, async (request, reply) => {
    const parsed = parse(codeRequestSchema, request, reply);
    if (parsed === null) return reply;
    const { auth, body } = parsed;
    const challenge = await challengeOf(body.challengeId, ['TOTP'], reply);
    if (challenge === null) return reply;
    const totp = await totpOf(deps.db, challenge.userId);
    if (totp === null) return refuse(reply, 409, 'TOTP_NOT_ENROLLED');
    if (totp.enabled) return refuse(reply, 409, 'TOTP_ALREADY_ENABLED');
    const secret = decryptTotpSecret(
      auth.totpKey,
      challenge.userId,
      totp.encrypted
    );
    if (!verifyTotp(secret, body.code, deps.now())) {
      await failChallenge(deps.db, challenge.id);
      return refuse(reply, 401, 'INVALID_CODE');
    }
    const backupCodes = newBackupCodes();
    // The authenticator, its backup codes and the alert to the mailbox commit together.
    await deps.db.transaction(async (tx) => {
      await enableTotp(
        tx,
        challenge.userId,
        backupCodes.map((code) => codeHash(auth.secret, code))
      );
      await enqueueMail(tx, { type: 'TOTP_ENABLED', userId: challenge.userId });
    });
    request.outboxQueued = true;
    const { roles } = await capabilitiesOf(deps.db, challenge.userId);
    await signIn(request, reply, challenge, roles);
    return confirmResponseSchema.parse({ backupCodes });
  });

  app.post('/v1/auth/verify', LIMITED, async (request, reply) => {
    const parsed = parse(verifyRequestSchema, request, reply);
    if (parsed === null) return reply;
    const { auth, body } = parsed;
    const remember = body.rememberDevice === true;
    const challenge = await challengeOf(
      body.challengeId,
      ['EMAIL', 'TOTP'],
      reply
    );
    if (challenge === null) return reply;
    if (challenge.type === 'EMAIL') {
      return passMailedCode(
        request,
        reply,
        auth,
        challenge,
        body.code,
        remember
      );
    }
    const totp = await totpOf(deps.db, challenge.userId);
    if (!totp?.enabled) return refuse(reply, 409, 'TOTP_NOT_ENROLLED');
    // Six digits: the authenticator. Eight: a backup code, spent on use.
    const passed = await (body.code.length === 6
      ? Promise.resolve(
          verifyTotp(
            decryptTotpSecret(auth.totpKey, challenge.userId, totp.encrypted),
            body.code,
            deps.now()
          )
        )
      : useBackupCode(
          deps.db,
          challenge.userId,
          codeHash(auth.secret, body.code),
          deps.now()
        ));
    if (!passed) {
      await failChallenge(deps.db, challenge.id);
      return refuse(reply, 401, 'INVALID_CODE');
    }
    const { roles } = await capabilitiesOf(deps.db, challenge.userId);
    await signIn(request, reply, challenge, roles, remember);
    return signedInSchema.parse({ status: 'signed_in' });
  });
}
