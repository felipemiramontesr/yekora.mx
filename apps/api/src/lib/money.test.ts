import { describe, expect, it } from 'vitest';
import { usdCents } from './money';

describe('usdCents', () => {
  it('matches the canonical case of the FC: 485000 MXN cents / 18.5000 = 26216 USD cents', () => {
    expect(usdCents(485000, 18.5)).toBe(26216);
  });

  it('rounds to the nearest cent', () => {
    expect(usdCents(186732, 18.6732)).toBe(10000);
    expect(usdCents(925, 18.5)).toBe(50); // 50.0
    expect(usdCents(934, 18.5)).toBe(50); // 50.49 → 50
    expect(usdCents(935, 18.5)).toBe(51); // 50.54 → 51
  });

  it.each([null, 0, -18.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'returns null without a valid FIX (%s): prices then show in MXN only',
    (fix) => {
      expect(usdCents(485000, fix)).toBeNull();
    }
  );
});
