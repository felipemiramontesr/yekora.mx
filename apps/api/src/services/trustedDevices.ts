/**
 * Trusted devices (FC 028 Enmienda 1, E2; T1.1 T, T2.9a–d): a buyer who passes the mailed code may
 * ask the site to remember the device for 30 days, and later sign in there with the password
 * alone.
 *
 * The browser keeps a random 256-bit token in the `__Host-yekora_device` cookie (lib/session.ts);
 * the database keeps only its SHA-256 (T2.9a), bound to the user, with its expiry. Staff and admin
 * never use it (T2.9b): routes/auth.ts neither issues nor honours a device for a privileged role.
 * Signing out keeps the device; «Forget this device» deletes it (T2.9d).
 *
 * @module
 */
import { newToken, tokenHash } from './authCrypto';
import type { Db } from './db';

/** T2.9c: how long a device stays trusted. */
export const DEVICE_SECONDS = 30 * 24 * 3600;

/**
 * Remembers this device for a buyer.
 *
 * @param db - Database port.
 * @param device - The user, the client facts and the clock.
 * @returns The token for the cookie (shown nowhere else, stored only as its SHA-256).
 */
export async function rememberDevice(
  db: Pick<Db, 'query'>,
  device: {
    userId: string;
    ip: string | null;
    userAgent: string | null;
    now: Date;
  }
): Promise<string> {
  const token = newToken();
  await db.query(
    'INSERT INTO user_trusted_devices (user_id, device_token_hash, expires_at, user_agent, ip_address) VALUES (?, ?, ?, ?, ?)',
    [
      device.userId,
      tokenHash(token),
      new Date(device.now.getTime() + DEVICE_SECONDS * 1000),
      device.userAgent,
      device.ip,
    ]
  );
  return token;
}

/**
 * Whether a device cookie is a live trusted device of this user.
 *
 * @param db - Database port.
 * @param token - The cookie's token.
 * @param userId - The user who just passed the password.
 * @param now - Clock.
 * @returns True only for this user's own, unexpired device.
 */
export async function isTrustedDevice(
  db: Db,
  token: string,
  userId: string,
  now: Date
): Promise<boolean> {
  const [row] = await db.query<{ id: number }>(
    'SELECT id FROM user_trusted_devices WHERE device_token_hash = ? AND user_id = ? AND expires_at > ?',
    [tokenHash(token), userId, now]
  );
  return row !== undefined;
}

/**
 * Forgets one device of a user (T2.9d).
 *
 * @param db - Database port.
 * @param token - The cookie's token.
 * @param userId - Its owner; another user's device is never touched.
 */
export async function forgetDevice(
  db: Db,
  token: string,
  userId: string
): Promise<void> {
  await db.query(
    'DELETE FROM user_trusted_devices WHERE device_token_hash = ? AND user_id = ?',
    [tokenHash(token), userId]
  );
}
