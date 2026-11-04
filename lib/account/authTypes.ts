/**
 * Sign-in contract shared by the browser and the API (FC 028, ADR 0008: one set of Zod schemas
 * for both ends): the bodies `/v1/auth/*` accepts, what they answer, and who `/v1/account/me`
 * says is signed in. It depends on Zod only, so the site bundle can import it.
 *
 * @module
 */
import { z } from 'zod';

/** An e-mail as typed: surrounding spaces are dropped before it is validated. */
const emailField = z.string().trim().pipe(z.email().max(255));

/**
 * The solved anti-bot challenge (Enmienda 1, T1.4): base64 JSON in the ALTCHA format. Optional in
 * the schema so /v1 stays compatible; the API answers 400 BOT_CHALLENGE_REQUIRED without it.
 */
const altchaField = z.string().min(1).max(2000).optional();

/** Body of `POST /v1/auth/register`. */
export const registerRequestSchema = z.strictObject({
  email: emailField,
  // NIST SP 800-63B: length over composition rules; 12 to 128 characters.
  password: z.string().min(12).max(128),
  fullName: z.string().trim().min(2).max(150),
  altcha: altchaField,
});

/** Body of `POST /v1/auth/login`. */
export const loginRequestSchema = z.strictObject({
  email: emailField,
  password: z.string().min(1).max(128),
  altcha: altchaField,
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

/**
 * Body of `POST /v1/auth/verify`: the code, and whether a buyer wants this device remembered for
 * 30 days (Enmienda 1, E2). Staff and admin are never remembered, whatever they send (T2.9b).
 */
export const verifyRequestSchema = codeRequestSchema.extend({
  rememberDevice: z.boolean().optional(),
});

/** Answer of `GET /v1/auth/bot-challenge`: a proof-of-work challenge in the ALTCHA format. */
export const botChallengeSchema = z.object({
  algorithm: z.literal('SHA-256'),
  challenge: z.string().regex(/^[0-9a-f]{64}$/),
  maxnumber: z.number().int().positive(),
  salt: z.string().min(1).max(200),
  signature: z.string().regex(/^[0-9a-f]{64}$/),
});

/** A challenge to solve. */
export type BotChallenge = z.infer<typeof botChallengeSchema>;

/** Answer of `POST /v1/auth/login`: what the second step must be. */
export const loginResponseSchema = z.object({
  challengeId: z.uuid(),
  // `enroll_totp` is no longer answered: enrolment now comes after the mailed code.
  next: z.enum(['verify', 'enroll_totp']),
  /** Where the code of `verify` comes from. */
  channel: z.enum(['email', 'authenticator']),
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

/** Answer of `GET /v1/account/me`. */
export const meResponseSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  fullName: z.string(),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
});

/** Who is signed in, as `GET /v1/account/me` answers. */
export type MeResponse = z.infer<typeof meResponseSchema>;
