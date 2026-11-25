import { describe, expect, it } from 'vitest';
import {
  boardActionsOf,
  canRequestReturn,
  returnableUnits,
  withinReturnWindow,
} from './returnRules';

const DELIVERED_AT = '2026-10-01T12:00:00.000Z';
const DAY_MS = 24 * 60 * 60 * 1000;
const at = (days: number, extraMs = 0) =>
  new Date(new Date(DELIVERED_AT).getTime() + days * DAY_MS + extraMs);

const LINE = { quantity: 2, allowsReturn: true, returnedQuantity: 0 };
const order = (
  overrides: Partial<Parameters<typeof canRequestReturn>[0]> = {}
) => ({
  fulfillment: 'DELIVERED' as const,
  deliveredAt: DELIVERED_AT,
  lines: [LINE],
  ...overrides,
});

describe('the window of 60 natural days (FC 073 T2.4)', () => {
  it('is open until the delivery moment plus 60 days, inclusive', () => {
    expect(withinReturnWindow(DELIVERED_AT, at(0))).toBe(true);
    expect(withinReturnWindow(DELIVERED_AT, at(60))).toBe(true);
    expect(withinReturnWindow(DELIVERED_AT, at(60, 1))).toBe(false);
  });

  it('is closed without a delivery', () => {
    expect(withinReturnWindow(null, at(0))).toBe(false);
    expect(withinReturnWindow(undefined, at(0))).toBe(false);
  });
});

describe('the units a line can still return (FC 073 T1.1 R, Q)', () => {
  it.each([
    [{ quantity: 3, allowsReturn: true, returnedQuantity: 0 }, 3],
    [{ quantity: 3, allowsReturn: true, returnedQuantity: 2 }, 1],
    [{ quantity: 3, allowsReturn: true, returnedQuantity: 3 }, 0],
    [{ quantity: 3, allowsReturn: true, returnedQuantity: 5 }, 0],
    [{ quantity: 3, allowsReturn: false, returnedQuantity: 0 }, 0],
  ])('%j gives %i', (line, units) => {
    expect(returnableUnits(line)).toBe(units);
  });
});

describe('the button of the order page (FC 073 T1.1)', () => {
  it('shows only when delivered, inside the window and with units to return', () => {
    expect(canRequestReturn(order(), at(10))).toBe(true);
  });

  it.each([
    ['not delivered', order({ fulfillment: 'SHIPPED' }), 10],
    ['no step yet', order({ fulfillment: null }), 10],
    ['no fulfillment field', order({ fulfillment: undefined }), 10],
    ['window over', order(), 61],
    ['no delivery date', order({ deliveredAt: null }), 10],
    ['a final sale', order({ lines: [{ ...LINE, allowsReturn: false }] }), 10],
    [
      'everything already asked',
      order({ lines: [{ ...LINE, returnedQuantity: 2 }] }),
      10,
    ],
    ['no lines', order({ lines: [] }), 10],
  ])('hides when %s', (_case, subject, days) => {
    expect(canRequestReturn(subject, at(days))).toBe(false);
  });

  it('shows when only one of the lines still has units', () => {
    const lines = [
      { ...LINE, returnedQuantity: 2 },
      { ...LINE, quantity: 1 },
    ];
    expect(canRequestReturn(order({ lines }), at(10))).toBe(true);
  });
});

describe('the steps the board offers (FC 073 T1.2a A, S and T1.2b A, S)', () => {
  const STAGES = ['REQUESTED', 'PREPARED', 'REFUNDING', 'REFUNDED'] as const;
  const BOTH = { canPrepare: true, canConfirm: true };
  const NONE = { canPrepare: false, canConfirm: false };

  it.each([
    ['REQUESTED', true, null],
    ['PREPARED', false, 'confirm'],
    ['REFUNDING', false, 'retry'],
    ['REFUNDED', false, null],
  ] as const)(
    '%s with both permissions: prepare=%s confirm=%s',
    (stage, prepare, confirm) => {
      expect(boardActionsOf(stage, BOTH)).toEqual({ prepare, confirm });
    }
  );

  it('offers nothing in any stage without permission', () => {
    for (const stage of STAGES) {
      expect(boardActionsOf(stage, NONE)).toEqual({
        prepare: false,
        confirm: null,
      });
    }
  });

  it('keeps each permission to its own step', () => {
    expect(
      boardActionsOf('REQUESTED', { canPrepare: true, canConfirm: false })
    ).toEqual({ prepare: true, confirm: null });
    expect(
      boardActionsOf('PREPARED', { canPrepare: true, canConfirm: false })
    ).toEqual({ prepare: false, confirm: null });
    expect(
      boardActionsOf('PREPARED', { canPrepare: false, canConfirm: true })
    ).toEqual({ prepare: false, confirm: 'confirm' });
    expect(
      boardActionsOf('REQUESTED', { canPrepare: false, canConfirm: true })
    ).toEqual({ prepare: false, confirm: null });
  });
});

describe('the closing moment of the window (FC 073 T2.4)', () => {
  it('is the delivery moment plus 60 natural days', async () => {
    const { returnWindowEndsAt } = await import('./returnRules');
    expect(returnWindowEndsAt(DELIVERED_AT).toISOString()).toBe(
      '2026-11-30T12:00:00.000Z'
    );
  });
});
