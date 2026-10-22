/**
 * Checkout cryptography (FC 012 F1 · YekoraALE · LFPDPPP · OWASP A02).
 *
 * Personal data (name, e-mail, phone, address) is stored only as AES-256-GCM ciphertext
 * produced with CHECKOUT_PII_KEY (32 random bytes, base64), never with the backup key. Each
 * value is bound to its order and column through the GCM additional data, so a ciphertext
 * copied into another order or column fails to decrypt instead of being read as someone
 * else's data. Stored format, versioned for a future key rotation:
 *
 *   0x01 · IV (12 B) · ciphertext · tag (16 B)
 *
 * Only encryption ships for now: nothing in the API reads personal data back yet, so the
 * decryption arrives with its first reader (order fulfilment) instead of as dead code.
 *
 * Lookups never need the plain e-mail: it is kept as HMAC-SHA256 under its own pepper
 * (CUSTOMER_EMAIL_HMAC_PEPPER), after trimming and lower-casing. The order access token is
 * 256 random bits, given to the buyer once and stored only as an HMAC (ORDER_TOKEN_PEPPER).
 * Order numbers are random, never sequential (A01): YEK-<year>-<8 of [0-9A-Z]>.
 *
 * @module
 */
import {
  createCipheriv,
  createHmac,
  randomBytes,
  randomInt,
} from 'node:crypto';

const FORMAT_V1 = 0x01;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const ORDER_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The personal-data columns of `orders`; the name is part of each value's additional data. */
export type PiiField =
  'customer_name' | 'customer_email' | 'customer_phone' | 'shipping_address';

/**
 * Decodes and checks CHECKOUT_PII_KEY: exactly 32 bytes in base64, or the API refuses to start.
 *
 * @param base64 - The secret as configured.
 * @returns The 256-bit key.
 */
export function parsePiiKey(base64: string): Buffer {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== KEY_BYTES || key.toString('base64') !== base64) {
    throw new Error('CHECKOUT_PII_KEY must be 32 random bytes in base64');
  }
  return key;
}

function additionalData(orderNumber: string, field: PiiField): Buffer {
  return Buffer.from(`${orderNumber}|${field}`, 'utf8');
}

/**
 * Encrypts one personal-data value for one order and column.
 *
 * @param key - Key from {@link parsePiiKey}.
 * @param orderNumber - The order the value belongs to.
 * @param field - The column it is stored in.
 * @param value - Plain text (UTF-8).
 * @returns The stored bytes: version, IV, ciphertext and tag.
 */
export function encryptPii(
  key: Buffer,
  orderNumber: string,
  field: PiiField,
  value: string
): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(additionalData(orderNumber, field));
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([
    Buffer.from([FORMAT_V1]),
    iv,
    body,
    cipher.getAuthTag(),
  ]);
}

/**
 * Keyed hash of an e-mail for lookups (same buyer, same hash), after trim and lower case.
 *
 * @param pepper - CUSTOMER_EMAIL_HMAC_PEPPER.
 * @param email - The address as entered.
 * @returns 32-byte HMAC-SHA256.
 */
export function emailHmac(pepper: string, email: string): Buffer {
  return createHmac('sha256', pepper)
    .update(email.trim().toLowerCase(), 'utf8')
    .digest();
}

/**
 * Stored form of an order access token.
 *
 * @param pepper - ORDER_TOKEN_PEPPER.
 * @param token - The token the buyer holds.
 * @returns 32-byte HMAC-SHA256.
 */
export function tokenHash(pepper: string, token: string): Buffer {
  return createHmac('sha256', pepper).update(token, 'utf8').digest();
}

/** A new order access token: 256 random bits, base64url (fits a URL fragment). */
export function newAccessToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * A new random order number, e.g. YEK-2026-7F3K9QX2 (36^8 ≈ 2.8 × 10¹² per year).
 *
 * @param now - Current time; its UTC year is part of the number.
 */
export function newOrderNumber(now: Date): string {
  let tail = '';
  for (let i = 0; i < 8; i += 1)
    tail += ORDER_ALPHABET[randomInt(ORDER_ALPHABET.length)];
  return `YEK-${now.getUTCFullYear()}-${tail}`;
}
