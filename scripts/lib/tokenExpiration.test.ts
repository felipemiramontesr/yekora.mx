import { describe, expect, it } from 'vitest';
import {
  ALERT_TITLE,
  alertAction,
  alertText,
  judgeToken,
  parseExpiration,
} from './tokenExpiration';

const NOW = new Date('2027-01-10T06:00:00Z');

describe('parseExpiration (FC 038 T1.1)', () => {
  it('reads the UTC form and the offset form of the header', () => {
    expect(parseExpiration('2027-01-31 06:00:00 UTC')?.toISOString()).toBe(
      '2027-01-31T06:00:00.000Z'
    );
    expect(parseExpiration('2027-01-31 00:00:00 -0600')?.toISOString()).toBe(
      '2027-01-31T06:00:00.000Z'
    );
  });

  it('returns null for an absent, foreign or impossible date (fail-closed upstream)', () => {
    expect(parseExpiration(null)).toBeNull();
    expect(parseExpiration('Sun, 31 Jan 2027 06:00:00 GMT')).toBeNull();
    expect(parseExpiration('2027-13-45 99:99:99 UTC')).toBeNull();
  });
});

describe('judgeToken (FC 038 T1.1)', () => {
  const answer = (expiration: string | null, status = 200) => ({
    status,
    expiration,
  });

  it('is ok with more than 15 whole days left', () => {
    expect(judgeToken(answer('2027-01-27 06:00:00 UTC'), NOW)).toMatchObject({
      state: 'ok',
      daysLeft: 17,
    });
  });

  it('is expiring at 15 days or fewer, including the last day', () => {
    expect(judgeToken(answer('2027-01-25 06:00:00 UTC'), NOW)).toMatchObject({
      state: 'expiring',
      daysLeft: 15,
    });
    expect(judgeToken(answer('2027-01-10 18:00:00 UTC'), NOW)).toMatchObject({
      state: 'expiring',
      daysLeft: 0,
    });
  });

  it('is broken on 401, any other status, no secret, or no readable date', () => {
    expect(judgeToken(answer(null, 401), NOW)).toEqual({
      state: 'broken',
      reason: 'GitHub lo rechaza (401): vencido, revocado o borrado',
    });
    expect(judgeToken(answer(null, 0), NOW)).toEqual({
      state: 'broken',
      reason: 'el secreto no está configurado',
    });
    expect(judgeToken(answer(null, 403), NOW)).toEqual({
      state: 'broken',
      reason: 'GitHub respondió 403',
    });
    expect(judgeToken(answer(null), NOW)).toEqual({
      state: 'broken',
      reason: 'GitHub no informó una fecha de vencimiento legible',
    });
  });
});

describe('alertAction (FC 038 T1.2: one issue per alert)', () => {
  const ok = judgeToken(
    { status: 200, expiration: '2027-04-30 06:00:00 UTC' },
    NOW
  );
  const expiring = judgeToken(
    { status: 200, expiration: '2027-01-20 06:00:00 UTC' },
    NOW
  );
  const broken = judgeToken({ status: 401, expiration: null }, NOW);

  it('creates the issue once, then only comments on it', () => {
    expect(alertAction(expiring, null)).toBe('create');
    expect(alertAction(expiring, 12)).toBe('comment');
    expect(alertAction(broken, null)).toBe('create');
    expect(alertAction(broken, 12)).toBe('comment');
  });

  it('closes the open issue once the rotated token is healthy, and does nothing otherwise', () => {
    expect(alertAction(ok, 12)).toBe('close');
    expect(alertAction(ok, null)).toBe('none');
  });
});

describe('alertText', () => {
  it('tells how many days are left and how to rotate, in both Actions and Dependabot', () => {
    const text = alertText(
      judgeToken({ status: 200, expiration: '2027-01-20 06:00:00 UTC' }, NOW)
    );
    expect(text).toContain('vence el 2027-01-20 (faltan 10 días)');
    expect(text).toContain('Actions **y** → Dependabot');
    expect(text).toContain('docs/security/dependency-triage.md §7');
  });

  it('names the failure of a broken token, and closes with the new date', () => {
    expect(
      alertText(judgeToken({ status: 401, expiration: null }, NOW))
    ).toContain('SECURITY_AUTOFIX_TOKEN no sirve: GitHub lo rechaza (401)');
    expect(
      alertText(
        judgeToken({ status: 200, expiration: '2027-04-30 06:00:00 UTC' }, NOW)
      )
    ).toBe(
      'El token ya fue renovado: vence el 2027-04-30 (faltan 110 días). Cierre automático (FC 038).'
    );
  });

  it('keeps the exact title the CLI searches for', () => {
    expect(ALERT_TITLE).toBe(
      '[SECURITY] SECURITY_AUTOFIX_TOKEN expira en menos de 15 días'
    );
  });
});
