/**
 * Anti-bot proof of work (FC 028 Enmienda 1, E1; T1.4, T2.8a–e), in the ALTCHA format and built on
 * `node:crypto`: no third party, no network.
 *
 *   challenge = SHA-256(salt + secret number)        signature = HMAC-SHA256(key, challenge)
 *
 * The browser tries numbers from 0 to `maxnumber` (20 000, about 0.3 s) until the hash matches and
 * sends back `altcha`: the solution as base64 JSON. The salt carries the expiry (5 minutes) and,
 * being inside the signed hash, cannot be changed. Each solved challenge is spent once: its hash
 * goes into `auth_challenge_nonces`, and a second insert of the same hash is refused (anti-replay).
 *
 * The signing key is AUTH_SECRET narrowed by a domain label, so it can sign nothing else.
 *
 * @module
 */
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import { z } from 'zod';
import type { BotChallenge } from '../../../../lib/account/authTypes';
import type { Db } from './db';

/** T2.8c: difficulty of every challenge. */
const MAX_NUMBER = 20_000;
/** T2.8d: lifetime of a challenge. */
const CHALLENGE_MS = 5 * 60_000;

/** T1.4: what a register or login request's `altcha` field amounts to. */
type BotCheck = 'passed' | 'BOT_CHALLENGE_REQUIRED' | 'BOT_CHALLENGE_FAILED';

const HEX_64 = /^[0-9a-f]{64}$/;
const solutionSchema = z.object({
  algorithm: z.literal('SHA-256'),
  challenge: z.string().regex(HEX_64),
  number: z.number().int().nonnegative().max(MAX_NUMBER),
  salt: z.string().min(1).max(200),
  signature: z.string().regex(HEX_64),
});

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

/** The key that signs challenges: AUTH_SECRET narrowed to this one use. */
function signingKey(secret: Buffer): Buffer {
  return createHmac('sha256', secret)
    .update('yekora-bot-challenge-v1')
    .digest();
}

const sign = (secret: Buffer, challenge: string) =>
  createHmac('sha256', signingKey(secret)).update(challenge).digest('hex');

const sameHex = (a: string, b: string) =>
  timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));

/**
 * A new challenge, valid for 5 minutes.
 *
 * @param secret - AUTH_SECRET.
 * @param now - Clock.
 * @returns The challenge for the browser to solve.
 */
export function issueChallenge(secret: Buffer, now: Date): BotChallenge {
  const expires = Math.floor((now.getTime() + CHALLENGE_MS) / 1000);
  const salt = `${randomBytes(12).toString('hex')}?expires=${expires}`;
  const challenge = sha256(`${salt}${randomInt(0, MAX_NUMBER + 1)}`);
  return {
    algorithm: 'SHA-256',
    challenge,
    maxnumber: MAX_NUMBER,
    salt,
    signature: sign(secret, challenge),
  };
}

/** The solution in an `altcha` field, or null when it is not one. */
function decode(payload: string): z.infer<typeof solutionSchema> | null {
  try {
    const parsed = solutionSchema.safeParse(
      JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The expiry (seconds) a salt carries, or null. */
function expiryOf(salt: string): number | null {
  const expires = Number(
    new URLSearchParams(salt.split('?')[1] ?? '').get('expires')
  );
  return Number.isInteger(expires) && expires > 0 ? expires : null;
}

/**
 * Checks the `altcha` field of a register or login request and spends it (T1.4).
 *
 * - absent: `BOT_CHALLENGE_REQUIRED`;
 * - malformed, expired, wrongly signed, wrongly solved or already spent: `BOT_CHALLENGE_FAILED`;
 * - otherwise `passed`, and the challenge can never be accepted again (T2.8b).
 *
 * @param db - Database port.
 * @param secret - AUTH_SECRET.
 * @param payload - The request's `altcha` field.
 * @param now - Clock.
 * @returns The outcome; only `passed` lets the password be checked or mail be queued (T2.8a).
 */
export async function checkChallenge(
  db: Db,
  secret: Buffer,
  payload: string | undefined,
  now: Date
): Promise<BotCheck> {
  if (!payload) return 'BOT_CHALLENGE_REQUIRED';
  const solution = decode(payload);
  const expires = solution ? expiryOf(solution.salt) : null;
  const valid =
    solution !== null &&
    expires !== null &&
    expires * 1000 > now.getTime() &&
    sameHex(sign(secret, solution.challenge), solution.signature) &&
    sameHex(sha256(`${solution.salt}${solution.number}`), solution.challenge);
  if (!valid) return 'BOT_CHALLENGE_FAILED';
  const spent: unknown = await db.query(
    'INSERT IGNORE INTO auth_challenge_nonces (nonce_hash, expires_at) VALUES (?, ?)',
    [solution.challenge, new Date(expires * 1000)]
  );
  // mysql2 answers a write with a result header; 0 rows means the challenge was spent before.
  return (spent as { affectedRows: number }).affectedRows === 1
    ? 'passed'
    : 'BOT_CHALLENGE_FAILED';
}
