/**
 * Identity repository (FC 028 F0, migration 004): users, their roles and permissions, sign-in
 * challenges, TOTP enrolment, backup codes and sessions. Static parameterized SQL only (ADR 0003).
 *
 * A password never opens a session: it only opens a 5-minute challenge with at most 5 attempts.
 * The session is created after the second factor, so no session ever skips 2FA (T2.1a):
 * - an `EMAIL` challenge carries the keyed hash of a 6-digit code sent by mail (FC 028 F1);
 * - a `TOTP` challenge waits for the authenticator or a backup code. A user without the
 *   authenticator reaches it only through a passed `EMAIL` challenge, so enrolling one always
 *   needs the mailbox too.
 * Sessions live 2 h for staff and admin and 8 h for buyers.
 *
 * @module
 */
import { randomUUID } from 'node:crypto';
import { isPrivileged } from '../lib/permissions';
import { codeHash, newToken, tokenHash } from './authCrypto';
import type { Db, Transactional } from './db';

/** Lifetime of a sign-in challenge. */
const CHALLENGE_MS = 5 * 60_000;
/** Wrong codes a challenge accepts before it is spent. */
const MAX_ATTEMPTS = 5;
/** Session lifetime for buyers and for staff or admin. */
const SESSION_MS = { customer: 8 * 3_600_000, privileged: 2 * 3_600_000 };

/** Alphabetical order for role and permission names, the same on every runtime. */
const byName = (a: string, b: string) => a.localeCompare(b, 'en');

/** A user as the sign-in reads it. */
interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  is_active: number;
}

/** Roles, permissions and TOTP state of a user. */
interface Capabilities {
  roles: string[];
  permissions: string[];
  totpEnabled: boolean;
}

/** A live sign-in challenge. */
export interface Challenge {
  id: string;
  userId: string;
  /** `EMAIL`: waits for the mailed code. `TOTP`: waits for the authenticator or a backup code. */
  type: 'EMAIL' | 'TOTP';
  /** Keyed hash of the mailed code (`EMAIL`) or of the challenge id (`TOTP`). */
  codeHash: string;
  attempts: number;
}

/** A session found by its cookie. */
export interface SessionUser extends Capabilities {
  sessionId: string;
  userId: string;
  email: string;
  fullName: string;
}

/**
 * Normalizes an e-mail for storage and lookup: trimmed, lower case.
 *
 * @param email - As typed.
 * @returns The canonical form.
 */
export function canonicalEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Client facts stored with a session (A09: who signed in from where), bounded in size.
 *
 * @param ip - Client address, as Fastify resolves it behind the proxy.
 * @param userAgent - The User-Agent header.
 * @returns The stored values, null when absent.
 */
export function clientFacts(
  ip: string | undefined,
  userAgent: string | undefined
): { ip: string | null; userAgent: string | null } {
  return { ip: ip || null, userAgent: userAgent?.slice(0, 500) ?? null };
}

/**
 * Finds an active user by e-mail.
 *
 * @param db - Database port.
 * @param email - Canonical e-mail.
 * @returns The user, or null.
 */
export async function findUserByEmail(
  db: Db,
  email: string
): Promise<UserRow | null> {
  const [row] = await db.query<UserRow>(
    'SELECT id, email, password_hash, full_name, is_active FROM users WHERE email = ? AND is_active = 1',
    [email]
  );
  return row ?? null;
}

/**
 * The e-mail of a user (for the authenticator's label).
 *
 * @param db - Database port.
 * @param userId - The user.
 * @returns Its canonical e-mail.
 */
export async function emailOf(db: Db, userId: string): Promise<string> {
  const [row] = await db.query<{ email: string }>(
    'SELECT email FROM users WHERE id = ?',
    [userId]
  );
  return row.email;
}

/**
 * Creates a buyer account (role `customer`), unless the e-mail is taken.
 *
 * @param db - Database with transactions.
 * @param user - Canonical e-mail, Argon2id hash and full name.
 * @returns True when created; false when the e-mail already had an account.
 */
export function createCustomer(
  db: Transactional,
  user: { email: string; passwordHash: string; fullName: string }
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [taken] = await tx.query<{ id: string }>(
      'SELECT id FROM users WHERE email = ? FOR UPDATE',
      [user.email]
    );
    if (taken) return false;
    const id = randomUUID();
    await tx.query(
      'INSERT INTO users (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)',
      [id, user.email, user.passwordHash, user.fullName]
    );
    await tx.query(
      "INSERT INTO user_roles (user_id, role_id) VALUES (?, 'customer')",
      [id]
    );
    return true;
  });
}

/**
 * Roles and permissions of a user (only active roles), and whether TOTP is on.
 *
 * @param db - Database port.
 * @param userId - The user.
 * @returns Its capabilities.
 */
export async function capabilitiesOf(
  db: Db,
  userId: string
): Promise<Capabilities> {
  const rows = await db.query<{
    role_id: string;
    permission_id: string | null;
  }>(
    'SELECT ur.role_id, rp.permission_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id AND r.is_active = 1 LEFT JOIN role_permissions rp ON rp.role_id = ur.role_id WHERE ur.user_id = ?',
    [userId]
  );
  const [totp] = await db.query<{ is_totp_enabled: number }>(
    'SELECT is_totp_enabled FROM two_factor_auth WHERE user_id = ?',
    [userId]
  );
  return {
    roles: [...new Set(rows.map((row) => row.role_id))].sort(byName),
    permissions: [
      ...new Set(
        rows.flatMap((row) => (row.permission_id ? [row.permission_id] : []))
      ),
    ].sort(byName),
    totpEnabled: Number(totp?.is_totp_enabled ?? 0) === 1,
  };
}

/**
 * Opens a sign-in challenge after a correct password.
 *
 * @param db - Database port, or the transaction that also queues the mailed code.
 * @param secret - AUTH_SECRET (keys the code hash).
 * @param userId - The user who passed the password.
 * @param now - Clock.
 * @param emailCode - The 6-digit code to mail; without it the challenge waits for TOTP.
 * @returns The challenge id the browser sends back with its code.
 */
export async function openChallenge(
  db: Pick<Db, 'query'>,
  secret: Buffer,
  userId: string,
  now: Date,
  emailCode?: string
): Promise<string> {
  const id = randomUUID();
  await db.query(
    'INSERT INTO two_factor_challenges (id, user_id, challenge_type, code_hash, expires_at) VALUES (?, ?, ?, ?, ?)',
    [
      id,
      userId,
      emailCode === undefined ? 'TOTP' : 'EMAIL',
      codeHash(secret, emailCode ?? id),
      new Date(now.getTime() + CHALLENGE_MS),
    ]
  );
  return id;
}

/**
 * Turns a passed `EMAIL` challenge into a `TOTP` one, for a privileged user who must now
 * enrol the authenticator (T2.1a). Its time and attempts stay as they were.
 *
 * @param db - Database port.
 * @param secret - AUTH_SECRET.
 * @param id - Challenge id.
 */
export async function passEmailChallenge(
  db: Db,
  secret: Buffer,
  id: string
): Promise<void> {
  await db.query(
    "UPDATE two_factor_challenges SET challenge_type = 'TOTP', code_hash = ? WHERE id = ? AND challenge_type = 'EMAIL'",
    [codeHash(secret, id), id]
  );
}

/**
 * Records that a user proved their mailbox, the first time only.
 *
 * @param db - Database port.
 * @param userId - The user.
 * @param now - Clock.
 */
export async function markEmailVerified(
  db: Db,
  userId: string,
  now: Date
): Promise<void> {
  await db.query(
    'UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?',
    [now, userId]
  );
}

/**
 * A live challenge: not expired and with attempts left.
 *
 * @param db - Database port.
 * @param id - Challenge id from the browser.
 * @param now - Clock.
 * @returns The challenge, or null.
 */
export async function liveChallenge(
  db: Db,
  id: string,
  now: Date
): Promise<Challenge | null> {
  const [row] = await db.query<{
    id: string;
    user_id: string;
    challenge_type: Challenge['type'];
    code_hash: string;
    attempts: number;
  }>(
    'SELECT id, user_id, challenge_type, code_hash, attempts FROM two_factor_challenges WHERE id = ? AND expires_at > ? AND attempts < ?',
    [id, now, MAX_ATTEMPTS]
  );
  return row
    ? {
        id: row.id,
        userId: row.user_id,
        type: row.challenge_type,
        codeHash: row.code_hash,
        attempts: Number(row.attempts),
      }
    : null;
}

/**
 * Counts one wrong code against a challenge.
 *
 * @param db - Database port.
 * @param id - Challenge id.
 */
export async function failChallenge(db: Db, id: string): Promise<void> {
  await db.query(
    'UPDATE two_factor_challenges SET attempts = attempts + 1 WHERE id = ? AND attempts < ?',
    [id, MAX_ATTEMPTS]
  );
}

/**
 * The stored TOTP secret of a user (pending or enabled).
 *
 * @param db - Database port.
 * @param userId - The user.
 * @returns The encrypted secret and whether it is enabled, or null when none was enrolled.
 */
export async function totpOf(
  db: Db,
  userId: string
): Promise<{ encrypted: string; enabled: boolean } | null> {
  const [row] = await db.query<{
    totp_secret_encrypted: string | null;
    is_totp_enabled: number;
  }>(
    'SELECT totp_secret_encrypted, is_totp_enabled FROM two_factor_auth WHERE user_id = ?',
    [userId]
  );
  if (!row?.totp_secret_encrypted) return null;
  return {
    encrypted: row.totp_secret_encrypted,
    enabled: Number(row.is_totp_enabled) === 1,
  };
}

/**
 * Stores a new, not yet enabled TOTP secret (enrolment step one).
 *
 * @param db - Database port.
 * @param userId - The user.
 * @param encrypted - `v1:…` ciphertext.
 */
export async function savePendingTotp(
  db: Db,
  userId: string,
  encrypted: string
): Promise<void> {
  await db.query(
    'INSERT INTO two_factor_auth (user_id, totp_secret_encrypted, is_totp_enabled) VALUES (?, ?, 0) ON DUPLICATE KEY UPDATE totp_secret_encrypted = VALUES(totp_secret_encrypted), is_totp_enabled = 0',
    [userId, encrypted]
  );
}

/**
 * Enables TOTP and replaces the backup codes, in one transaction (143_AN B2).
 *
 * @param tx - Transaction.
 * @param userId - The user.
 * @param codeHashes - Keyed hashes of the eight new backup codes.
 */
export async function enableTotp(
  tx: Pick<Db, 'query'>,
  userId: string,
  codeHashes: readonly string[]
): Promise<void> {
  await tx.query(
    'UPDATE two_factor_auth SET is_totp_enabled = 1 WHERE user_id = ?',
    [userId]
  );
  await tx.query('DELETE FROM two_factor_backup_codes WHERE user_id = ?', [
    userId,
  ]);
  // Static SQL per code (ADR 0003); the transaction's connection queues them in order.
  await Promise.all(
    codeHashes.map((hash) =>
      tx.query(
        'INSERT INTO two_factor_backup_codes (user_id, code_hash) VALUES (?, ?)',
        [userId, hash]
      )
    )
  );
}

/**
 * Spends one unused backup code.
 *
 * @param db - Database port.
 * @param userId - The user.
 * @param hash - Keyed hash of the typed code.
 * @param now - Clock.
 * @returns True when the code existed unused and is now spent.
 */
export async function useBackupCode(
  db: Db,
  userId: string,
  hash: string,
  now: Date
): Promise<boolean> {
  const result: unknown = await db.query(
    'UPDATE two_factor_backup_codes SET is_used = 1, used_at = ? WHERE user_id = ? AND code_hash = ? AND is_used = 0',
    [now, userId, hash]
  );
  // mysql2 answers a write with a result header, not rows (same reading as checkout.ts).
  return (result as { affectedRows: number }).affectedRows === 1;
}

/**
 * Ends a challenge and opens the session, in one transaction.
 *
 * @param tx - Transaction.
 * @param input - Challenge (null when a buyer's trusted device stood in for the second factor,
 *   Enmienda 1), user, privilege, client and clock.
 * @returns The session token for the cookie, and its lifetime in seconds.
 */
export async function openSession(
  tx: Pick<Db, 'query'>,
  input: {
    challengeId: string | null;
    userId: string;
    privileged: boolean;
    ip: string | null;
    userAgent: string | null;
    now: Date;
  }
): Promise<{ token: string; maxAgeSeconds: number }> {
  const token = newToken();
  const lifetime = input.privileged
    ? SESSION_MS.privileged
    : SESSION_MS.customer;
  if (input.challengeId !== null) {
    await tx.query('DELETE FROM two_factor_challenges WHERE id = ?', [
      input.challengeId,
    ]);
  }
  await tx.query(
    'INSERT INTO user_sessions (id, user_id, refresh_token_hash, ip_address, user_agent, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    [
      tokenHash(token),
      input.userId,
      // Reserved for the refresh flow; no refresh token is issued yet, so nothing can match it.
      tokenHash(newToken()),
      input.ip,
      input.userAgent,
      new Date(input.now.getTime() + lifetime),
    ]
  );
  return { token, maxAgeSeconds: lifetime / 1000 };
}

/**
 * The user behind a session cookie, if the session is alive and the user active.
 *
 * @param db - Database port.
 * @param token - Cookie value.
 * @param now - Clock.
 * @returns The user with its capabilities, or null.
 */
export async function sessionUser(
  db: Db,
  token: string,
  now: Date
): Promise<SessionUser | null> {
  const [row] = await db.query<{
    id: string;
    user_id: string;
    email: string;
    full_name: string;
  }>(
    'SELECT s.id, s.user_id, u.email, u.full_name FROM user_sessions s JOIN users u ON u.id = s.user_id AND u.is_active = 1 WHERE s.id = ? AND s.expires_at > ?',
    [tokenHash(token), now]
  );
  if (!row) return null;
  const capabilities = await capabilitiesOf(db, row.user_id);
  return {
    sessionId: row.id,
    userId: row.user_id,
    email: row.email,
    fullName: row.full_name,
    ...capabilities,
  };
}

/**
 * Ends a session.
 *
 * @param db - Database port.
 * @param sessionId - SHA-256 id of the session.
 */
export async function closeSession(db: Db, sessionId: string): Promise<void> {
  await db.query('DELETE FROM user_sessions WHERE id = ?', [sessionId]);
}

/**
 * Whether a session may act: a privileged user must have TOTP on (T2.1a: 403 otherwise).
 *
 * @param user - The session's user.
 * @returns True when its second factor matches its role.
 */
export function secondFactorSatisfied(user: Capabilities): boolean {
  return !isPrivileged(user.roles) || user.totpEnabled;
}
