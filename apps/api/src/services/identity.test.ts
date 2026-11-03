import { describe, expect, it } from 'vitest';
import { canonicalEmail, clientFacts, secondFactorSatisfied } from './identity';

describe('identity helpers (FC 028)', () => {
  it('stores e-mails trimmed and in lower case', () => {
    expect(canonicalEmail('  Ana@Example.TEST ')).toBe('ana@example.test');
  });

  it('keeps the client address and a bounded User-Agent, null when absent', () => {
    expect(clientFacts('203.0.113.7', 'Mozilla/5.0')).toEqual({
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0',
    });
    expect(clientFacts('', undefined)).toEqual({ ip: null, userAgent: null });
    expect(clientFacts(undefined, 'x'.repeat(600)).userAgent).toHaveLength(500);
  });

  it('requires TOTP of staff and admin only (T2.1a)', () => {
    const user = (roles: string[], totpEnabled: boolean) => ({
      roles,
      permissions: [],
      totpEnabled,
    });
    expect(secondFactorSatisfied(user(['customer'], false))).toBe(true);
    expect(secondFactorSatisfied(user(['admin'], false))).toBe(false);
    expect(secondFactorSatisfied(user(['admin'], true))).toBe(true);
  });
});
