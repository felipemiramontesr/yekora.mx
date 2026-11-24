/**
 * FC 071 T0.2 and T1.1 evidence: the 32 rows of ReturnEligibilityGate(O, D, W, A, Q) and the
 * window of 60 natural days.
 */
import { describe, expect, it } from 'vitest';
import {
  decideReturnLine,
  type EligibilityCode,
  withinReturnWindow,
} from './returnsEligibility';

const FIRST_FALSE: readonly [string, EligibilityCode][] = [
  ['owner', 'DATA_DOMAIN_FORBIDDEN'],
  ['delivered', 'ORDER_NOT_DELIVERED_REJECT'],
  ['withinWindow', 'WINDOW_EXPIRED_REJECT'],
  ['allowsReturn', 'PRODUCT_NON_RETURNABLE_REJECT'],
  ['validQuantity', 'INVALID_QUANTITY_REJECT'],
];

/** The 32 combinations in the order of the table: O is the slowest, Q the fastest, ⊤ before ⊥. */
const ROWS = Array.from({ length: 32 }, (_, index) => {
  const bits = [4, 3, 2, 1, 0].map((shift) => ((index >> shift) & 1) === 0);
  const [owner, delivered, withinWindow, allowsReturn, validQuantity] = bits;
  const failed = FIRST_FALSE.find((_pair, at) => !bits[at]);
  return {
    label: bits.map((bit) => (bit ? '⊤' : '⊥')).join(''),
    inputs: { owner, delivered, withinWindow, allowsReturn, validQuantity },
    code: failed ? failed[1] : ('RETURN_ELIGIBLE_OK' as EligibilityCode),
  };
});

describe('T1.1 · ReturnEligibilityGate(O, D, W, A, Q), the 32 rows', () => {
  it.each(ROWS)('$label → $code', ({ inputs, code }) => {
    expect(decideReturnLine(inputs)).toBe(code);
  });

  it('is eligible in exactly one row, the one where every input holds', () => {
    expect(
      ROWS.filter((row) => row.code === 'RETURN_ELIGIBLE_OK')
    ).toHaveLength(1);
    expect(ROWS[0].label).toBe('⊤⊤⊤⊤⊤');
  });

  it('answers the code of the first input that fails, as the table words it', () => {
    const base = {
      owner: true,
      delivered: true,
      withinWindow: true,
      allowsReturn: true,
      validQuantity: true,
    };
    expect(decideReturnLine({ ...base, owner: false, delivered: false })).toBe(
      'DATA_DOMAIN_FORBIDDEN'
    );
    expect(
      decideReturnLine({ ...base, delivered: false, allowsReturn: false })
    ).toBe('ORDER_NOT_DELIVERED_REJECT');
    expect(
      decideReturnLine({ ...base, withinWindow: false, validQuantity: false })
    ).toBe('WINDOW_EXPIRED_REJECT');
    expect(
      decideReturnLine({ ...base, allowsReturn: false, validQuantity: false })
    ).toBe('PRODUCT_NON_RETURNABLE_REJECT');
  });
});

describe('T0.2 · the window of 60 natural days since the delivery', () => {
  const DELIVERED = new Date('2026-09-01T18:00:00.000Z');
  const DAY = 24 * 60 * 60 * 1000;

  it('is open the day of the delivery and on the 60th day, to the millisecond', () => {
    expect(withinReturnWindow(DELIVERED, DELIVERED)).toBe(true);
    expect(
      withinReturnWindow(DELIVERED, new Date(DELIVERED.getTime() + 60 * DAY))
    ).toBe(true);
  });

  it('is over one millisecond after the 60th day', () => {
    expect(
      withinReturnWindow(
        DELIVERED,
        new Date(DELIVERED.getTime() + 60 * DAY + 1)
      )
    ).toBe(false);
  });

  it('is closed without a delivery', () => {
    expect(withinReturnWindow(null, DELIVERED)).toBe(false);
  });
});
