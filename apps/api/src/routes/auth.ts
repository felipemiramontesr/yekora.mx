/**
 * Sign-up and sign-in (FC 028 F0, 143_AN B2): `/v1/auth/*`, public by nature, rate limited.
 *
 * - `register` never says whether an e-mail already had an account (202 either way).
 * - `login` checks the password (an unknown e-mail costs the same Argon2id work) and opens a
 *   5-minute challenge; it never opens a session.
 * - `totp/enroll` and `totp/confirm` turn TOTP on for a user who has none; confirming also
 *   issues the 8 backup codes, shown once, and opens the session.
 * - `verify` takes a TOTP code or a backup code and opens the session.
 * A wrong code counts against the challenge (5 at most). The e-mail code arrives in FC 028 F1
 * with the outbox. Without AUTH_SECRET and TOTP_ENCRYPTION_KEY every route answers 503.
 *
 * @module
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthSecrets } from '../config';
import { problem, PROBLEM_TYPE } from '../lib/problem';
import { isPrivileged } from '../lib/permissions';
import { sessionCookie } from '../lib/session';
import {
  codeHash,
  decryptTotpSecret,
  encryptTotpSecret,
  newBackupCodes,
  newTotpSecret,
  otpauthUri,
  base32,
  verifyTotp,
} from '../services/authCrypto';
import type { Db, Transactional } from '../services/db';
import {
  canonicalEmail,
  clientFacts,
  capabilitiesOf,
  createCustomer,
  emailOf,
  enableTotp,
  failChallenge,
  findUserByEmail,
  liveChallenge,
  openChallenge,
  openSession,
  savePendingTotp,
  totpOf,
  useBackupCode,
  type Challenge,
} from '../services/identity';
import { decoyHash, hashPassword, verifyPassword } from '../services/passwords';

/** An e-mail as typed: surrounding spaces are dropped before it is validated. */
const emailField = z.string().trim().pipe(z.email().max(255));

/** Body of `POST /v1/auth/register`. */
export const registerRequestSchema = z.strictObject({
  email: emailField,
  // NIST SP 800-63B: length over composition rules; 12 to 128 characters.
  password: z.string().min(12).max(128),
  fullName: z.string().trim().min(2).max(150),
});

/** Body of `POST /v1/auth/login`. */
export const loginRequestSchema = z.strictObject({
  email: emailField,
  password: z.string().min(1).max(128),
});

/** Body of `POST /v1/auth/totp/enroll`. */
export const challengeRequestSchema = z.strictObject({
  challengeId: z.uuid(),
});

/** Body of `POST /v1/auth/totp/confirm` and `POST /v1/auth/verify`. */
export const codeRequestSchema = z.strictObject({
  challengeId: z.uuid(),
  code: z.string().regex(/^(?:\d{6}|\d{8})$/),
});

/** Answer of `POST /v1/auth/login`: what the second step must be. */
export const loginResponseSchema = z.object({
  challengeId: z.uuid(),
  next: z.enum(['verify', 'enroll_totp']),
});

/** Answer of `POST /v1/auth/totp/enroll`: the secret, for the app or typed by hand. */
export const enrollResponseSchema = z.object({
  secret: z.string().regex(/^[A-Z2-7]+$/),
  otpauthUri: z.string().startsWith('otpauth://totp/'),
});

/** Answer of `POST /v1/auth/totp/confirm`: the backup codes, shown this once. */
export const confirmResponseSchema = z.object({
  backupCodes: z.array(z.string().regex(/^\d{8}$/)).length(8),
});

/** Answer of a successful `POST /v1/auth/verify`. */
export const signedInSchema = z.object({ status: z.literal('signed_in') });

/** Answer of `POST /v1/auth/register`, whatever happened to the e-mail. */
export const registeredSchema = z.object({ status: z.literal('accepted') });

/** Dependencies of the auth routes. */
interface AuthDeps {
  db: Db & Transactional;
  auth: AuthSecrets | null;
  now: () => Date;
}

const TITLES: Record<string, string> = {
  AUTH_UNAVAILABLE: 'Sign-in unavailable',
  INVALID_REQUEST: 'Invalid request',
  INVALID_CREDENTIALS: 'Invalid e-mail or password',
  INVALID_CHALLENGE: 'Sign-in expired, start again',
  INVALID_CODE: 'Invalid code',
  TOTP_ALREADY_ENABLED: 'Authenticator already enabled',
  TOTP_NOT_ENROLLED: 'Set up the authenticator first',
};

/** An RFC 7807 refusal whose detail is its machine code. */
function refuse(reply: FastifyReply, status: number, code: string) {
  return reply
    .code(status)
    .type(PROBLEM_TYPE)
    .send(problem(status, TITLES[code], code));
}

const LIMITED = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

/**
 * Registers the sign-up and sign-in routes.
 *
 * @param app - Fastify instance.
 * @param deps - Database, identity secrets and clock.
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

  /** The live challenge of a body, or a 401 and null. */
  async function challengeOf(
    challengeId: string,
    reply: FastifyReply
  ): Promise<Challenge | null> {
    const challenge = await liveChallenge(deps.db, challengeId, deps.now());
    if (challenge === null) void refuse(reply, 401, 'INVALID_CHALLENGE');
    return challenge;
  }

  /** Opens the session of a passed challenge and sets the cookie. */
  async function signIn(
    request: FastifyRequest,
    reply: FastifyReply,
    challenge: Challenge
  ): Promise<void> {
    const { roles } = await capabilitiesOf(deps.db, challenge.userId);
    const { token, maxAgeSeconds } = await deps.db.transaction((tx) =>
      openSession(tx, {
        challengeId: challenge.id,
        userId: challenge.userId,
        privileged: isPrivileged(roles),
        ...clientFacts(request.ip, request.headers['user-agent']),
        now: deps.now(),
      })
    );
    reply.header('Set-Cookie', sessionCookie(token, maxAgeSeconds));
  }

  app.post('/v1/auth/register', LIMITED, async (request, reply) => {
    const parsed = parse(registerRequestSchema, request, reply);
    if (parsed === null) return reply;
    const { body } = parsed;
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
    const user = await findUserByEmail(deps.db, canonicalEmail(body.email));
    // Always one Argon2id verification, against the decoy when the e-mail is unknown.
    const valid = await verifyPassword(
      user?.password_hash ?? (await decoyHash()),
      body.password
    );
    if (user === null || !valid) {
      return refuse(reply, 401, 'INVALID_CREDENTIALS');
    }
    const totp = await totpOf(deps.db, user.id);
    const challengeId = await openChallenge(
      deps.db,
      auth.secret,
      user.id,
      deps.now()
    );
    return loginResponseSchema.parse({
      challengeId,
      next: totp?.enabled ? 'verify' : 'enroll_totp',
    });
  });

  app.post('/v1/auth/totp/enroll', LIMITED, async (request, reply) => {
    const parsed = parse(challengeRequestSchema, request, reply);
    if (parsed === null) return reply;
    const { auth, body } = parsed;
    const challenge = await challengeOf(body.challengeId, reply);
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
    const challenge = await challengeOf(body.challengeId, reply);
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
    await deps.db.transaction((tx) =>
      enableTotp(
        tx,
        challenge.userId,
        backupCodes.map((code) => codeHash(auth.secret, code))
      )
    );
    await signIn(request, reply, challenge);
    return confirmResponseSchema.parse({ backupCodes });
  });

  app.post('/v1/auth/verify', LIMITED, async (request, reply) => {
    const parsed = parse(codeRequestSchema, request, reply);
    if (parsed === null) return reply;
    const { auth, body } = parsed;
    const challenge = await challengeOf(body.challengeId, reply);
    if (challenge === null) return reply;
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
    await signIn(request, reply, challenge);
    return signedInSchema.parse({ status: 'signed_in' });
  });
}
