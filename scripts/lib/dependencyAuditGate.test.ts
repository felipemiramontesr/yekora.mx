import { describe, expect, it } from 'vitest';
import { type AcceptedException, judgeAudit } from './dependencyAuditGate';

const TODAY = '2026-11-01';
const advisory = (id: number, severity: string, title = 'x') => ({
  id,
  severity,
  title,
});
const exception = (
  packageName: string,
  advisoryId: number,
  reviewBy = '2026-12-31'
): AcceptedException => ({
  packageName,
  advisoryId,
  reason: 'no fix',
  reviewBy,
});

describe('judgeAudit (FC 036 T2.1: every severity blocks)', () => {
  it('passes a clean report', () => {
    expect(judgeAudit({}, [], TODAY)).toMatchObject({
      pass: true,
      blocking: [],
      excepted: [],
    });
  });

  it.each(['critical', 'high', 'moderate', 'low', 'info'])(
    'blocks a %s advisory the same as any other',
    (severity) => {
      const verdict = judgeAudit(
        { pkg: [advisory(1, severity, 'title')] },
        [],
        TODAY
      );
      expect(verdict.pass).toBe(false);
      expect(verdict.blocking).toEqual([
        { packageName: 'pkg', advisoryId: 1, severity, title: 'title' },
      ]);
      expect(verdict.counts[severity as 'low']).toBe(1);
    }
  );

  it('blocks an unknown severity (fail-closed) and tolerates a missing title', () => {
    const verdict = judgeAudit(
      { pkg: [{ id: 2, severity: 'weird' }] },
      [],
      TODAY
    );
    expect(verdict.counts.unknown).toBe(1);
    expect(verdict.blocking[0].title).toBe('');
  });

  it('lets through only the exact package and advisory of a current exception', () => {
    const report = {
      a: [advisory(1, 'moderate'), advisory(2, 'low')],
      b: [advisory(1, 'low')],
    };
    const verdict = judgeAudit(report, [exception('a', 1)], TODAY);
    expect(verdict.excepted.map((f) => [f.packageName, f.advisoryId])).toEqual([
      ['a', 1],
    ]);
    expect(verdict.blocking.map((f) => [f.packageName, f.advisoryId])).toEqual([
      ['a', 2],
      ['b', 1],
    ]);
  });

  it('holds an exception through its review day and blocks again the day after', () => {
    const report = { a: [advisory(1, 'low')] };
    expect(judgeAudit(report, [exception('a', 1, TODAY)], TODAY).pass).toBe(
      true
    );
    const late = judgeAudit(report, [exception('a', 1, '2026-10-31')], TODAY);
    expect(late.pass).toBe(false);
    expect(late.expired).toEqual([exception('a', 1, '2026-10-31')]);
    expect(late.blocking).toHaveLength(1);
  });

  it('fails on a stale exception whose advisory is no longer reported', () => {
    const verdict = judgeAudit({}, [exception('braces', 1240992)], TODAY);
    expect(verdict.pass).toBe(false);
    expect(verdict.stale).toEqual([exception('braces', 1240992)]);
  });

  it('refuses a malformed report', () => {
    expect(() => judgeAudit([], [], TODAY)).toThrow(/expected an object/);
    expect(() => judgeAudit(null, [], TODAY)).toThrow(/expected an object/);
    expect(() => judgeAudit({ a: 'x' }, [], TODAY)).toThrow(/not a list/);
  });
});
