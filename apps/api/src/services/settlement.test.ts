import { describe, expect, it } from 'vitest';
import { settle } from './settlement';

describe('T1.4 · OrderSettlementFsmGate(P, S, E), the 8 rows', () => {
  it.each([
    [true, false, false, 'ORDER_PAID', 200, 2, false, true],
    [false, true, false, 'ALREADY_PAID', 200, null, false, false],
    [false, false, true, 'LATE_PAYMENT_NEEDS_REVIEW', 200, 6, true, false],
    [false, false, false, 'PAYMENT_NEEDS_REVIEW_ALERT', 200, null, true, false],
    [true, true, false, 'STATE_CONFLICT_ANOMALY', 500, null, true, false],
    [true, false, true, 'STATE_CONFLICT_ANOMALY', 500, null, true, false],
    [false, true, true, 'STATE_CONFLICT_ANOMALY', 500, null, true, false],
    [true, true, true, 'STATE_CONFLICT_ANOMALY', 500, null, true, false],
  ] as const)(
    'P=%s S=%s E=%s → %s',
    (p, s, e, code, httpStatus, nextStatusId, alert, sellsStock) => {
      expect(settle(p, s, e)).toEqual({
        code,
        httpStatus,
        nextStatusId,
        alert,
        sellsStock,
      });
    }
  );

  it('accepts exactly the three rows of its formula; every other row alerts', () => {
    const bits = [true, false];
    const tuples = bits.flatMap((p) =>
      bits.flatMap((s) => bits.map((e) => [p, s, e] as const))
    );
    const formula = ([p, s, e]: readonly boolean[]) =>
      (p && !s && !e) || (!p && s && !e) || (!p && !s && e);
    const rows = tuples.map((tuple) => ({ tuple, row: settle(...tuple) }));
    expect(
      rows.filter(({ tuple }) => formula(tuple)).map(({ row }) => row.code)
    ).toEqual(['ORDER_PAID', 'ALREADY_PAID', 'LATE_PAYMENT_NEEDS_REVIEW']);
    // None of the refused rows settles silently.
    expect(
      rows.filter(({ tuple, row }) => !formula(tuple) && !row.alert)
    ).toEqual([]);
  });
});
