import { describe, expect, it, vi } from 'vitest';
import { signedByAny, webhookSecretsOf } from './webhookSecrets';

describe('the secrets of a webhook while one is rotated (FC 075 F1, T1.2)', () => {
  it.each([
    ['whsec_new', ['whsec_new']],
    ['whsec_new,whsec_old', ['whsec_new', 'whsec_old']],
    [' whsec_new , whsec_old ', ['whsec_new', 'whsec_old']],
    ['whsec_new,,', ['whsec_new']],
    ['', []],
    [' , ', []],
  ])('reads %j', (value, secrets) => {
    expect(webhookSecretsOf(value)).toEqual(secrets);
  });

  it('accepts a signature made with any of them, and none otherwise', () => {
    expect(signedByAny('a,b', (secret) => secret === 'a')).toBe(true);
    expect(signedByAny('a,b', (secret) => secret === 'b')).toBe(true);
    expect(signedByAny('a,b', (secret) => secret === 'c')).toBe(false);
    expect(signedByAny('', () => true)).toBe(false);
  });

  it('tries every secret even after one matched, so the time tells nothing', () => {
    const matches = vi.fn().mockReturnValue(true);
    expect(signedByAny('a,b', matches)).toBe(true);
    expect(matches).toHaveBeenCalledTimes(2);
  });
});
