import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  base32,
  codeHash,
  decryptTotpSecret,
  encryptTotpSecret,
  newBackupCodes,
  newToken,
  newTotpSecret,
  otpauthUri,
  parseAuthKey,
  tokenHash,
  verifyTotp,
} from './authCrypto';

const KEY = Buffer.alloc(32, 7);
const KEY_B64 = KEY.toString('base64');
/** An independent RFC 4226 HOTP, so verifyTotp is checked against more than itself. */
function totpCode(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', secret).update(counter).digest();
  const value = mac.readUInt32BE(mac[mac.length - 1] & 0x0f) & 0x7fffffff;
  return String(value % 1_000_000).padStart(6, '0');
}
// RFC 6238 Appendix B: the SHA-1 seed "12345678901234567890".
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');

describe('parseAuthKey', () => {
  it('accepts exactly 32 bytes in canonical base64', () => {
    expect(parseAuthKey('AUTH_SECRET', KEY_B64)).toEqual(KEY);
  });

  it('refuses a short key or a non-canonical encoding, naming the variable', () => {
    expect(() => parseAuthKey('AUTH_SECRET', 'c2hvcnQ=')).toThrow(
      'AUTH_SECRET must be 32 random bytes in base64'
    );
    expect(() =>
      parseAuthKey('TOTP_ENCRYPTION_KEY', `${KEY_B64.slice(0, -1)}#`)
    ).toThrow('TOTP_ENCRYPTION_KEY');
  });
});

describe('tokens and codes (FC 028 T2.2)', () => {
  it('makes 256-bit tokens and stores only their SHA-256', () => {
    const token = newToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(newToken()).not.toBe(token);
    expect(tokenHash('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('keys short codes with AUTH_SECRET, so the stored hash is useless without it', () => {
    expect(codeHash(KEY, '12345678')).toMatch(/^[0-9a-f]{64}$/);
    expect(codeHash(KEY, '12345678')).not.toBe(
      codeHash(Buffer.alloc(32, 8), '12345678')
    );
  });

  it('issues eight distinct eight-digit backup codes', () => {
    const codes = newBackupCodes();
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    expect(codes.every((code) => /^\d{8}$/.test(code))).toBe(true);
  });
});

describe('TOTP (RFC 6238, SHA-1, 30 s, 6 digits)', () => {
  it.each([
    [59, '287082'],
    [1_111_111_109, '081804'],
    [1_234_567_890, '005924'],
    [2_000_000_000, '279037'],
  ])('matches the RFC test vector at T = %i', (seconds, code) => {
    expect(totpCode(RFC_SECRET, Math.floor(seconds / 30))).toBe(code);
    expect(verifyTotp(RFC_SECRET, code, new Date(seconds * 1000))).toBe(true);
  });

  it('accepts the current step and one either side, nothing further or malformed', () => {
    const now = new Date(1_234_567_890_000);
    const step = Math.floor(1_234_567_890 / 30);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step), now)).toBe(true);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), now)).toBe(
      true
    );
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 1), now)).toBe(
      true
    );
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 2), now)).toBe(
      false
    );
    expect(verifyTotp(RFC_SECRET, '12345', now)).toBe(false);
    expect(verifyTotp(RFC_SECRET, '12a456', now)).toBe(false);
  });

  it('writes the secret in base32 and the provisioning URI apps scan', () => {
    expect(base32(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32(newTotpSecret())).toMatch(/^[A-Z2-7]{32}$/);
    expect(otpauthUri('ana@yekora.mx', Buffer.from('foobar'))).toBe(
      'otpauth://totp/Y%C4%92KORA%3Aana%40yekora.mx?secret=MZXW6YTBOI&issuer=Y%C4%92KORA&algorithm=SHA1&digits=6&period=30'
    );
  });
});

describe('TOTP secret at rest (AES-256-GCM, TOTP_ENCRYPTION_KEY)', () => {
  const user = '11111111-1111-4111-8111-111111111111';

  it('round-trips in the versioned format', () => {
    const secret = newTotpSecret();
    const stored = encryptTotpSecret(KEY, user, secret);
    expect(stored).toMatch(/^v1:[\w-]+:[\w-]+:[\w-]+$/);
    expect(decryptTotpSecret(KEY, user, stored)).toEqual(secret);
  });

  it('fails for another user, another key, a tampered value or an unknown version', () => {
    const stored = encryptTotpSecret(KEY, user, newTotpSecret());
    expect(() => decryptTotpSecret(KEY, 'someone-else', stored)).toThrow();
    expect(() =>
      decryptTotpSecret(Buffer.alloc(32, 9), user, stored)
    ).toThrow();
    expect(() =>
      decryptTotpSecret(KEY, user, `${stored.slice(0, -2)}AA`)
    ).toThrow();
    expect(() => decryptTotpSecret(KEY, user, 'v2:a:b:c')).toThrow(
      'Unknown TOTP secret format'
    );
    expect(() => decryptTotpSecret(KEY, user, 'v1:a:b')).toThrow(
      'Unknown TOTP secret format'
    );
  });
});
