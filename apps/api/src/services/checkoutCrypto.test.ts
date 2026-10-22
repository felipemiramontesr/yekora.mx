import { createDecipheriv, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  emailHmac,
  encryptPii,
  newAccessToken,
  newOrderNumber,
  parsePiiKey,
  tokenHash,
} from './checkoutCrypto';

const KEY = randomBytes(32);
const ORDER = 'YEK-2026-ABCD1234';

/**
 * Reads format 1 independently of the production code (which only encrypts): the bytes on disk
 * must be version · IV · ciphertext · tag, with the order and column as additional data.
 */
function openPii(
  key: Buffer,
  orderNumber: string,
  field: string,
  stored: Buffer
) {
  const decipher = createDecipheriv('aes-256-gcm', key, stored.subarray(1, 13));
  decipher.setAAD(Buffer.from(`${orderNumber}|${field}`));
  decipher.setAuthTag(stored.subarray(-16));
  return Buffer.concat([
    decipher.update(stored.subarray(13, -16)),
    decipher.final(),
  ]).toString();
}

describe('parsePiiKey', () => {
  it('accepts exactly 32 bytes in canonical base64', () => {
    const raw = randomBytes(32);
    expect(parsePiiKey(raw.toString('base64')).equals(raw)).toBe(true);
  });

  it('refuses another length, an empty value or non-canonical base64', () => {
    for (const bad of [
      randomBytes(16).toString('base64'),
      '',
      randomBytes(32).toString('hex'),
      `${randomBytes(32).toString('base64')}\n`,
    ]) {
      expect(() => parsePiiKey(bad)).toThrow(
        'CHECKOUT_PII_KEY must be 32 random bytes'
      );
    }
  });
});

describe('personal data at rest (T2: only AES-256-GCM ciphertext)', () => {
  const address = 'Av. Barones 209, Las Américas, Guadalupe, Zac. 98612 · ñ 🏔';

  it('round-trips UTF-8 and never stores the plain text', () => {
    const stored = encryptPii(KEY, ORDER, 'shipping_address', address);
    expect(stored[0]).toBe(0x01);
    expect(stored).toHaveLength(1 + 12 + Buffer.byteLength(address) + 16);
    expect(stored.includes(Buffer.from('Barones'))).toBe(false);
    expect(openPii(KEY, ORDER, 'shipping_address', stored)).toBe(address);
  });

  it('uses a fresh IV each time: the same value never repeats its ciphertext', () => {
    const a = encryptPii(KEY, ORDER, 'customer_email', 'ana@example.com');
    const b = encryptPii(KEY, ORDER, 'customer_email', 'ana@example.com');
    expect(a.equals(b)).toBe(false);
  });

  it('fails instead of reading: wrong key, other order, other column, or one flipped bit', () => {
    const stored = encryptPii(KEY, ORDER, 'customer_phone', '4929421780');
    expect(() =>
      openPii(randomBytes(32), ORDER, 'customer_phone', stored)
    ).toThrow();
    expect(() =>
      openPii(KEY, 'YEK-2026-ZZZZ9999', 'customer_phone', stored)
    ).toThrow();
    expect(() => openPii(KEY, ORDER, 'customer_name', stored)).toThrow();
    for (const offset of [5, 20, stored.length - 1]) {
      const altered = Buffer.from(stored);
      altered[offset] ^= 0x01;
      expect(() => openPii(KEY, ORDER, 'customer_phone', altered)).toThrow();
    }
  });
});

describe('keyed hashes', () => {
  it('hashes an e-mail the same however it is typed, and differently per pepper', () => {
    const a = emailHmac('pepper', '  Ana@Example.COM ');
    expect(a).toHaveLength(32);
    expect(a.equals(emailHmac('pepper', 'ana@example.com'))).toBe(true);
    expect(a.equals(emailHmac('other', 'ana@example.com'))).toBe(false);
  });

  it('stores tokens only as their HMAC, stable per pepper', () => {
    const token = newAccessToken();
    expect(tokenHash('p', token).equals(tokenHash('p', token))).toBe(true);
    expect(tokenHash('p', token).equals(tokenHash('q', token))).toBe(false);
    expect(tokenHash('p', token).toString('utf8')).not.toContain(token);
  });
});

describe('random identifiers', () => {
  it('access tokens carry 256 bits in URL-safe base64 and never repeat', () => {
    const tokens = new Set(Array.from({ length: 1000 }, newAccessToken));
    expect(tokens.size).toBe(1000);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('order numbers match the database CHECK, carry the UTC year and are not sequential', () => {
    const now = new Date('2026-12-31T23:30:00Z');
    const numbers = Array.from({ length: 1000 }, () => newOrderNumber(now));
    for (const n of numbers) expect(n).toMatch(/^YEK-2026-[0-9A-Z]{8}$/);
    expect(new Set(numbers).size).toBe(1000);
    expect(newOrderNumber(new Date('2027-01-01T00:00:00Z'))).toMatch(
      /^YEK-2027-/
    );
  });
});
