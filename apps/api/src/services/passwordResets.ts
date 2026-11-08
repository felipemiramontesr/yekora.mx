/**
 * Password reset links (FC 042 F1, T1.1, T1.2, T2.2, T2.3): the rows of `password_reset_tokens`
 * (migration 007) behind «¿Olvidaste tu contraseña?».
 *
 * A link carries 32 random bytes in hex; the row keeps only their SHA-256, so the database never
 * holds a working link. A link lasts {@link RESET_TTL_MS} and serves once. Changing the password
 * spends every open link of the account, ends every session of it (T2.3), writes the audit entry
 * and queues the confirmation mail, all in one transaction.
 *
 * @module
 */
import { randomBytes } from 'node:crypto';
import { recordAudit } from './audit';
import { tokenHash } from './authCrypto';
import type { Db, Transactional, TxQuery } from './db';
import { enqueueMail } from './outbox';

/** How long a mailed link opens the reset form: 15 minutes (T2.2). */
const RESET_TTL_MS = 15 * 60_000;

/** A link still valid, with what the password policy needs to know about its account. */
interface LiveReset {
  /** Row of `password_reset_tokens`. */
  id: number;
  userId: string;
  email: string;
  fullName: string;
}

/**
 * Opens a reset link for an active account, in the caller's transaction.
 *
 * @param tx - Transaction that also queues the mail of the link.
 * @param userId - The account.
 * @param now - Current time.
 * @returns The token of the link (64 hex characters); only its hash is stored.
 */
export async function openReset(
  tx: TxQuery,
  userId: string,
  now: Date
): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await tx.query(
    'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
    [userId, tokenHash(token), new Date(now.getTime() + RESET_TTL_MS)]
  );
  return token;
}

/**
 * The link behind a token, while it is unspent, unexpired and its account active.
 *
 * @param db - Database port.
 * @param token - Token of the mailed link.
 * @param now - Current time.
 * @returns The link, or null.
 */
export async function liveReset(
  db: Db,
  token: string,
  now: Date
): Promise<LiveReset | null> {
  const [row] = await db.query<{
    id: number;
    user_id: string;
    email: string;
    full_name: string;
  }>(
    'SELECT t.id, t.user_id, u.email, u.full_name FROM password_reset_tokens t JOIN users u ON u.id = t.user_id AND u.is_active = 1 WHERE t.token_hash = ? AND t.consumed_at IS NULL AND t.expires_at > ?',
    [tokenHash(token), now]
  );
  return row
    ? {
        id: Number(row.id),
        userId: row.user_id,
        email: row.email,
        fullName: row.full_name,
      }
    : null;
}

/**
 * Sets the new password through a live link (T2.3): spends this link (only if still unspent, so
 * two submissions never both win) and every other open link of the account, ends all its
 * sessions, audits the change without personal data and queues the confirmation mail.
 *
 * @param db - Database with transactions.
 * @param reset - The link, as {@link liveReset} found it.
 * @param passwordHash - Argon2id hash of the new password.
 * @param now - Current time.
 * @param ip - Client address, for the audit entry.
 * @returns False when the link was spent in the meantime; nothing changed then.
 */
export function completeReset(
  db: Transactional,
  reset: LiveReset,
  passwordHash: string,
  now: Date,
  ip: string | null
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const spent: unknown = await tx.query(
      'UPDATE password_reset_tokens SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL',
      [now, reset.id]
    );
    if ((spent as { affectedRows: number }).affectedRows !== 1) return false;
    await tx.query('UPDATE users SET password_hash = ? WHERE id = ?', [
      passwordHash,
      reset.userId,
    ]);
    await tx.query(
      'UPDATE password_reset_tokens SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL',
      [now, reset.userId]
    );
    await tx.query('DELETE FROM user_sessions WHERE user_id = ?', [
      reset.userId,
    ]);
    await recordAudit(tx, {
      userId: reset.userId,
      action: 'PASSWORD_RESET',
      entityType: 'users',
      entityId: reset.userId,
      before: null,
      after: { sessionsRevoked: true },
      ip,
    });
    await enqueueMail(tx, { type: 'PASSWORD_CHANGED', userId: reset.userId });
    return true;
  });
}
