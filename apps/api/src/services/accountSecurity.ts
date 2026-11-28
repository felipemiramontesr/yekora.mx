/**
 * The sessions and the remembered devices of an account, and the change of its password from a
 * session (FC 079 F0).
 *
 * - Every statement that changes something names the account (`user_id = ?`); a session or a device
 *   of someone else is told apart from one that does not exist by reading it first (T2.2).
 * - The session one is using is never closed here: that is signing out (T0.3).
 * - Dates are compared with the clock of the API, never with the database's.
 *
 * Every statement is static SQL with `?` placeholders (A03).
 *
 * @module
 */
import type { Db, TxQuery } from './db';

/** Why closing one session or forgetting one device is refused. */
export type RevocationRefusal =
  | 'SESSION_NOT_FOUND'
  | 'CANNOT_REVOKE_CURRENT_SESSION'
  | 'SESSION_FORBIDDEN'
  | 'DEVICE_NOT_FOUND'
  | 'DEVICE_FORBIDDEN';

/** Status and title of each refusal. */
export const REVOCATION_REFUSALS: Readonly<
  Record<RevocationRefusal, readonly [number, string]>
> = {
  SESSION_NOT_FOUND: [404, 'Not found'],
  CANNOT_REVOKE_CURRENT_SESSION: [400, 'Sign out to close this session'],
  SESSION_FORBIDDEN: [403, 'The session belongs to another account'],
  DEVICE_NOT_FOUND: [404, 'Not found'],
  DEVICE_FORBIDDEN: [403, 'The device belongs to another account'],
};

/** Where a session or a device was opened from. */
interface OriginRow {
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
}

const originOf = (row: OriginRow) => ({
  ip: row.ip_address,
  userAgent: row.user_agent,
  createdAt: row.created_at.toISOString(),
});

/**
 * The live sessions of an account.
 *
 * @param db - Database port.
 * @param userId - The account.
 * @param current - The session asking.
 * @param now - Clock.
 * @returns Its sessions, newest first, the one asking marked.
 */
export async function listSessions(
  db: Db,
  userId: string,
  current: string,
  now: Date
) {
  const rows = await db.query<OriginRow & { id: string }>(
    'SELECT id, ip_address, user_agent, created_at FROM user_sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC, id ASC',
    [userId, now]
  );
  return rows.map((row) => ({
    id: row.id,
    isCurrent: row.id === current,
    ...originOf(row),
  }));
}

/**
 * The live remembered devices of an account.
 *
 * @param db - Database port.
 * @param userId - The account.
 * @param now - Clock.
 * @returns Its devices, newest first.
 */
export async function listDevices(db: Db, userId: string, now: Date) {
  const rows = await db.query<OriginRow & { id: number; expires_at: Date }>(
    'SELECT id, ip_address, user_agent, created_at, expires_at FROM user_trusted_devices WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC, id DESC',
    [userId, now]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    expiresAt: row.expires_at.toISOString(),
    ...originOf(row),
  }));
}

/**
 * Closes one session of the account, judged in order (T1.2): it exists and lives, it is not the
 * one asking, and it is the account's.
 *
 * @param tx - Transaction of the request.
 * @param input - The session to close, the account, the session asking and the clock.
 * @returns Null when closed, or why not.
 */
export async function closeOneSession(
  tx: TxQuery,
  input: { id: string; userId: string; current: string; now: Date }
): Promise<RevocationRefusal | null> {
  const { id, userId, current, now } = input;
  const [row] = await tx.query<{ user_id: string }>(
    'SELECT user_id FROM user_sessions WHERE id = ? AND expires_at > ? FOR UPDATE',
    [id, now]
  );
  if (row === undefined) return 'SESSION_NOT_FOUND';
  if (id === current) return 'CANNOT_REVOKE_CURRENT_SESSION';
  if (row.user_id !== userId) return 'SESSION_FORBIDDEN';
  await tx.query('DELETE FROM user_sessions WHERE id = ? AND user_id = ?', [
    id,
    userId,
  ]);
  return null;
}

/**
 * Closes every session of the account but the one asking.
 *
 * @param tx - Transaction.
 * @param userId - The account.
 * @param current - The session that stays.
 */
export async function closeOtherSessions(
  tx: TxQuery,
  userId: string,
  current: string
): Promise<void> {
  await tx.query('DELETE FROM user_sessions WHERE user_id = ? AND id <> ?', [
    userId,
    current,
  ]);
}

/**
 * Forgets every remembered device of the account.
 *
 * @param tx - Transaction.
 * @param userId - The account.
 */
export async function forgetAllDevices(
  tx: TxQuery,
  userId: string
): Promise<void> {
  await tx.query('DELETE FROM user_trusted_devices WHERE user_id = ?', [
    userId,
  ]);
}

/**
 * Forgets one remembered device of the account.
 *
 * @param tx - Transaction of the request.
 * @param id - The device.
 * @param userId - The account.
 * @returns Null when forgotten, or why not.
 */
export async function forgetOneDevice(
  tx: TxQuery,
  id: number,
  userId: string
): Promise<RevocationRefusal | null> {
  const [row] = await tx.query<{ user_id: string }>(
    'SELECT user_id FROM user_trusted_devices WHERE id = ? FOR UPDATE',
    [id]
  );
  if (row === undefined) return 'DEVICE_NOT_FOUND';
  if (row.user_id !== userId) return 'DEVICE_FORBIDDEN';
  await tx.query(
    'DELETE FROM user_trusted_devices WHERE id = ? AND user_id = ?',
    [id, userId]
  );
  return null;
}

/**
 * The stored password hash of an account.
 *
 * @param db - Transaction of the change.
 * @param userId - The account of the session.
 * @returns The Argon2id hash.
 */
export async function passwordHashOf(
  db: TxQuery,
  userId: string
): Promise<string> {
  const [row] = await db.query<{ password_hash: string }>(
    'SELECT password_hash FROM users WHERE id = ?',
    [userId]
  );
  return row.password_hash;
}

/**
 * Stores a new password and closes whatever else was open with the old one (T2.1): every other
 * session and every remembered device.
 *
 * @param tx - Transaction of the request.
 * @param input - The account, the Argon2id hash of the new password and the session that stays.
 */
export async function storePassword(
  tx: TxQuery,
  input: { userId: string; hash: string; current: string }
): Promise<void> {
  await tx.query('UPDATE users SET password_hash = ? WHERE id = ?', [
    input.hash,
    input.userId,
  ]);
  await closeOtherSessions(tx, input.userId, input.current);
  await forgetAllDevices(tx, input.userId);
}
