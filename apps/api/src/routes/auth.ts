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
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import {
  challengeRequestSchema,
  codeRequestSchema,
  confirmResponseSchema,
  enrollResponseSchema,
  loginRequestSchema,
  loginResponseSchema,
  registeredSchema,
  registerRequestSchema,
  signedInSchema,
  verifyRequestSchema,
} from '../../../../lib/account/authTypes';
import type { AuthSecrets } from '../config';
import { problem, PROBLEM_TYPE } from '../lib/problem';
import { isPrivileged } from '../lib/permissions';
import { deviceCookie, readDeviceToken, sessionCookie } from '../lib/session';
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
import { decoyHash, hashPassword, verifyPassword } from '../services/passwords';
import { isTrustedDevice, rememberDevice } from '../services/trustedDevices';

/** Dependencies of the auth routes. */
interface AuthDeps {
  db: Db & Transactional;
  auth: AuthSecrets | null;
  /** Whether the outbox can mail (an SMTP account is configured). */
  mailReady: boolean;
  now: () => Date;
}

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
};

/** An RFC 7807 refusal whose detail is its machine code. */
function refuse(reply: FastifyReply, status: number, code: string) {
  return reply
    .code(status)
    .type(PROBLEM_TYPE)
    .send(problem(status, TITLES[code], code));
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
    await createCustomer(deps.db, {
      email: canonicalEmail(body.email),
      passwordHash: await hashPassword(body.password),
      fullName: body.fullName,
    });
    return reply.code(202).send(registeredSchema.parse({ status: 'accepted' }));
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
