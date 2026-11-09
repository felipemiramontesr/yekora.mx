import { describe, expect, it } from 'vitest';
import { decoyReset } from './passwordResets';

const KEY = Buffer.alloc(32, 7);

describe('decoyReset (FC 042 T2.1, «hash simulado»)', () => {
  it('does the encryption of a real link and returns its ciphertext, fresh every time', () => {
    const first = decoyReset(KEY);
    expect(first).toMatch(/^v1:[\w-]+:[\w-]+:[\w-]+$/);
    expect(decoyReset(KEY)).not.toBe(first);
  });
});
