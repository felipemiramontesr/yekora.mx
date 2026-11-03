import { describe, expect, it } from 'vitest';
import { decoyHash, hashPassword, verifyPassword } from './passwords';

describe('passwords (FC 028 T2.1b: Argon2id through hash-wasm)', () => {
  it('hashes with Argon2id, its OWASP parameters and a salt of its own', async () => {
    const a = await hashPassword('correct horse battery staple');
    const b = await hashPassword('correct horse battery staple');
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(a).not.toBe(b);
  });

  it('verifies the right password and refuses a wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(
      true
    );
    expect(await verifyPassword(hash, 'Correct horse battery staple')).toBe(
      false
    );
  });

  it('answers false, never throws, for a malformed hash', async () => {
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });

  it('makes one real decoy hash per process that matches nothing typed', async () => {
    const decoy = await decoyHash();
    expect(decoy).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await decoyHash()).toBe(decoy);
    expect(await verifyPassword(decoy, '')).toBe(false);
  });
});
