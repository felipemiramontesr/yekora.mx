/**
 * Identity cryptography (FC 028 T2.1–T2.2, ADR 0011 §3, 277_AN V2): everything a login needs
 * that is not the password itself.
 *
 * - Session tokens are 256 random bits given only in the cookie; the database keeps their
 *   SHA-256 (`user_sessions.id`), so a leaked table opens no session.
 * - One-time codes (backup codes, e-mail codes) are short, so a plain hash would fall to brute
 *   force: they are stored as HMAC-SHA256 under AUTH_SECRET, useless without the key.
 * - TOTP secrets are AES-256-GCM ciphertext under TOTP_ENCRYPTION_KEY, its own key (never the
 *   backup key nor the personal-data key), bound to their user through the GCM additional data.
 *   Stored format, versioned for a future rotation: `v1:<iv>:<tag>:<ciphertext>` (base64url).
 * - TOTP is RFC 6238 on `node:crypto` (SHA-1, 30 s, 6 digits), as Archon does: no library.
 *
 * @module
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

const KEY_BYTES = 32;
const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Decodes and checks a 256-bit secret: exactly 32 bytes in base64, or the API refuses to start.
 *
 * @param name - Environment variable, for the message.
 * @param base64 - The secret as configured.
 * @returns The key.
 */
export function parseAuthKey(name: string, base64: string): Buffer {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== KEY_BYTES || key.toString('base64') !== base64) {
    throw new Error(`${name} must be 32 random bytes in base64`);
  }
  return key;
}

/**
 * A new session or challenge token: 256 random bits, base64url.
 *
 * @returns The token, as given to the browser.
 */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Stored form of a high-entropy token (session id): its SHA-256 in hex.
 *
 * @param token - The token the browser holds.
 * @returns 64 hex characters.
 */
export function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Stored form of a short one-time code: HMAC-SHA256 under AUTH_SECRET, in hex.
 *
 * @param secret - AUTH_SECRET.
 * @param code - The code as typed (digits only).
 * @returns 64 hex characters.
 */
export function codeHash(secret: Buffer, code: string): string {
  return createHmac('sha256', secret).update(code, 'utf8').digest('hex');
}

/**
 * The 8 backup codes of a user, 8 digits each, shown once (143_AN B2).
 *
 * @returns Eight distinct codes.
 */
export function newBackupCodes(): string[] {
  const codes = new Set<string>();
  while (codes.size < 8)
    codes.add(String(randomInt(0, 100_000_000)).padStart(8, '0'));
  return [...codes];
}

/**
 * A new TOTP secret: 160 random bits (RFC 4226 §4).
 *
 * @returns The raw secret.
 */
export function newTotpSecret(): Buffer {
  return randomBytes(20);
}

/**
 * Base32 (RFC 4648, no padding), the form authenticator apps read.
 *
 * @param bytes - Raw secret.
 * @returns Upper-case base32.
 */
export function base32(bytes: Buffer): string {
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) {
    out += BASE32[Number.parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  }
  return out;
}

/**
 * The `otpauth://` URI an authenticator app scans (Google, Microsoft, Authy).
 *
 * @param email - The account, shown in the app.
 * @param secret - Raw TOTP secret.
 * @returns The provisioning URI.
 */
export function otpauthUri(email: string, secret: Buffer): string {
  const label = encodeURIComponent(`YĒKORA:${email}`);
  return `otpauth://totp/${label}?secret=${base32(secret)}&issuer=${encodeURIComponent('YĒKORA')}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

/** The TOTP code of one time step (RFC 6238 over RFC 4226, HMAC-SHA1, 6 digits). */
function totpCode(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', secret).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const value = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(value % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

/**
 * Checks a typed TOTP code against the current step and one step either side (clock drift).
 *
 * @param secret - Raw TOTP secret.
 * @param code - The code as typed.
 * @param now - The server's clock.
 * @returns True when it matches one of the three steps.
 */
export function verifyTotp(secret: Buffer, code: string, now: Date): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const step = Math.floor(now.getTime() / 1000 / TOTP_STEP_SECONDS);
  return [step - 1, step, step + 1].some((candidate) =>
    timingSafeEqual(Buffer.from(totpCode(secret, candidate)), Buffer.from(code))
  );
}

/**
 * Encrypts a TOTP secret for one user (AES-256-GCM, user id as additional data).
 *
 * @param key - TOTP_ENCRYPTION_KEY.
 * @param userId - Owner of the secret.
 * @param secret - Raw TOTP secret.
 * @returns `v1:<iv>:<tag>:<ciphertext>`, base64url parts.
 */
export function encryptTotpSecret(
  key: Buffer,
  userId: string,
  secret: Buffer
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(userId, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  const parts = [iv, cipher.getAuthTag(), ciphertext].map((b) =>
    b.toString('base64url')
  );
  return `v1:${parts.join(':')}`;
}

/**
 * Decrypts a TOTP secret; fails if it was altered or belongs to another user.
 *
 * @param key - TOTP_ENCRYPTION_KEY.
 * @param userId - Expected owner.
 * @param stored - Value of `two_factor_auth.totp_secret_encrypted`.
 * @returns The raw secret.
 * @throws When the format, the key, the owner or the ciphertext does not match.
 */
export function decryptTotpSecret(
  key: Buffer,
  userId: string,
  stored: string
): Buffer {
  const [version, iv, tag, ciphertext] = stored.split(':');
  if (version !== 'v1' || ciphertext === undefined) {
    throw new Error('Unknown TOTP secret format');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(iv, 'base64url')
  );
  decipher.setAAD(Buffer.from(userId, 'utf8'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]);
}
