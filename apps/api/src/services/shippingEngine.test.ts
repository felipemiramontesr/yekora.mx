import { describe, expect, it } from 'vitest';
import {
  evaluateShipping,
  purchaseClass,
  type ShippingConfig,
  type ShippingRule,
} from './shippingEngine';

/** The engine's purchase facts (the type is internal to the engine). */
type ShipmentFacts = Parameters<typeof evaluateShipping>[2];

const ZAC = 32;
const JAL = 15;
const STANDARD = 1;
const BULKY = 2;

const facts = (over: Partial<ShipmentFacts> = {}): ShipmentFacts => ({
  zoneId: ZAC,
  classId: STANDARD,
  chargeableGrams: 6000,
  itemsTotalMxnCents: 185000,
  ...over,
});

const rule = (
  id: number,
  rateMxnCents: number,
  over: Partial<ShippingRule> = {}
): ShippingRule => ({
  id,
  zoneId: null,
  classId: null,
  minWeightGrams: null,
  maxWeightGrams: null,
  minItemsTotalMxnCents: null,
  maxItemsTotalMxnCents: null,
  rateMxnCents,
  ...over,
});

const config = (
  strategy: string,
  over: Partial<ShippingConfig> = {}
): ShippingConfig => ({
  strategy,
  freeShippingActive: false,
  freeShippingThresholdMxnCents: null,
  ...over,
});

describe('T1.1 · R: a configuration and a covering rule, or no tariff at all', () => {
  it('R ⊤ → SERVICEABLE with the rule rate and its VAT split (073 rule)', () => {
    expect(
      evaluateShipping(config('FLAT_RATE'), [rule(1, 15000)], facts())
    ).toEqual({
      serviceable: true,
      code: 'STANDARD_RATE',
      strategy: 'FLAT_RATE',
      ruleId: 1,
      totalMxnCents: 15000,
      baseMxnCents: 12931, // round(15000 × 100 / 116) = round(12931.03)
      taxMxnCents: 2069,
      freeShippingRemainingMxnCents: null,
    });
  });

  it('R ⊥ without configuration (Ω option A): UNSERVICEABLE, rules or not', () => {
    expect(evaluateShipping(null, [rule(1, 15000)], facts())).toEqual({
      serviceable: false,
      code: 'UNSERVICEABLE_DESTINATION',
    });
  });

  it('R ⊥ with configuration but no covering rule: UNSERVICEABLE, never invented', () => {
    expect(evaluateShipping(config('FLAT_RATE'), [], facts())).toEqual({
      serviceable: false,
      code: 'UNSERVICEABLE_DESTINATION',
    });
  });

  it('R ⊥ for a strategy code the engine does not know', () => {
    expect(
      evaluateShipping(config('PER_UNIT'), [rule(1, 15000)], facts())
    ).toEqual({
      serviceable: false,
      code: 'UNSERVICEABLE_DESTINATION',
    });
  });
});

describe('T1.2 · FreeShippingGranted ⟺ A ∧ Q (only once a rule covers the purchase)', () => {
  const rules = [rule(1, 15000)];
  const on = (threshold: number) =>
    config('FLAT_RATE', {
      freeShippingActive: true,
      freeShippingThresholdMxnCents: threshold,
    });

  it('A ⊤ Q ⊤ → FREE_SHIPPING: $0, base 0, tax 0 (also exactly at the threshold)', () => {
    for (const threshold of [100000, 185000]) {
      expect(evaluateShipping(on(threshold), rules, facts())).toMatchObject({
        serviceable: true,
        code: 'FREE_SHIPPING',
        totalMxnCents: 0,
        baseMxnCents: 0,
        taxMxnCents: 0,
      });
    }
  });

  it('A ⊤ Q ⊥ → STANDARD_RATE: one cent below the threshold pays', () => {
    expect(evaluateShipping(on(185001), rules, facts())).toMatchObject({
      code: 'STANDARD_RATE',
      totalMxnCents: 15000,
    });
  });

  it('A ⊥ Q ⊤ → STANDARD_RATE: a stored threshold means nothing while the modifier is off', () => {
    const off = config('FLAT_RATE', { freeShippingThresholdMxnCents: 1 });
    expect(evaluateShipping(off, rules, facts())).toMatchObject({
      code: 'STANDARD_RATE',
    });
  });

  it('A ⊥ Q ⊥ → STANDARD_RATE', () => {
    expect(
      evaluateShipping(
        config('FLAT_RATE'),
        rules,
        facts({ itemsTotalMxnCents: 1 })
      )
    ).toMatchObject({ code: 'STANDARD_RATE', totalMxnCents: 15000 });
  });

  it('free shipping never rescues a purchase no rule covers (scope of T1.2)', () => {
    expect(evaluateShipping(on(1), [], facts())).toEqual({
      serviceable: false,
      code: 'UNSERVICEABLE_DESTINATION',
    });
  });

  it('modifier on without a threshold (impossible by CHECK) is treated as off', () => {
    const broken = config('FLAT_RATE', { freeShippingActive: true });
    expect(evaluateShipping(broken, rules, facts())).toMatchObject({
      code: 'STANDARD_RATE',
    });
  });
});

describe('strategies', () => {
  it('ZONE_RATE prices by the destination state only', () => {
    const rules = [
      rule(1, 9900, { zoneId: JAL }),
      rule(2, 12900, { zoneId: ZAC }),
    ];
    expect(evaluateShipping(config('ZONE_RATE'), rules, facts())).toMatchObject(
      {
        ruleId: 2,
        totalMxnCents: 12900,
      }
    );
    expect(
      evaluateShipping(config('ZONE_RATE'), rules, facts({ zoneId: 7 }))
    ).toMatchObject({
      serviceable: false,
    });
  });

  it('ZONE_CLASS_RATE needs both the state and the purchase class', () => {
    const rules = [
      rule(1, 12900, { zoneId: ZAC, classId: STANDARD }),
      rule(2, 29900, { zoneId: ZAC, classId: BULKY }),
    ];
    expect(
      evaluateShipping(
        config('ZONE_CLASS_RATE'),
        rules,
        facts({ classId: BULKY })
      )
    ).toMatchObject({ ruleId: 2, totalMxnCents: 29900 });
    expect(
      evaluateShipping(
        config('ZONE_CLASS_RATE'),
        rules,
        facts({ classId: null })
      )
    ).toMatchObject({ serviceable: false });
    expect(
      evaluateShipping(
        config('ZONE_CLASS_RATE'),
        rules,
        facts({ zoneId: JAL, classId: BULKY })
      )
    ).toMatchObject({ serviceable: false });
  });

  it('CHARGEABLE_WEIGHT uses [min, max): the bound belongs to the next bracket', () => {
    const rules = [
      rule(1, 9900, { minWeightGrams: 0, maxWeightGrams: 5000 }),
      rule(2, 14900, { minWeightGrams: 5000, maxWeightGrams: 10000 }),
      rule(3, 24900, { minWeightGrams: 10000 }),
    ];
    const at = (grams: number) =>
      evaluateShipping(
        config('CHARGEABLE_WEIGHT'),
        rules,
        facts({ chargeableGrams: grams })
      );
    expect(at(4999)).toMatchObject({ ruleId: 1 });
    expect(at(5000)).toMatchObject({ ruleId: 2 });
    expect(at(9999)).toMatchObject({ ruleId: 2 });
    expect(at(10000)).toMatchObject({ ruleId: 3 });
    expect(at(1_000_000)).toMatchObject({ ruleId: 3 }); // open-ended last bracket
  });

  it('CHARGEABLE_WEIGHT leaves a gap uncovered instead of inventing a rate', () => {
    const rules = [
      rule(1, 9900, { minWeightGrams: 1000, maxWeightGrams: 5000 }),
    ];
    expect(
      evaluateShipping(
        config('CHARGEABLE_WEIGHT'),
        rules,
        facts({ chargeableGrams: 999 })
      )
    ).toMatchObject({ serviceable: false });
  });

  it('ORDER_TOTAL uses [min, max) over the items total with VAT', () => {
    const rules = [
      rule(1, 19900, {
        minItemsTotalMxnCents: 0,
        maxItemsTotalMxnCents: 100000,
      }),
      rule(2, 9900, { minItemsTotalMxnCents: 100000 }),
    ];
    const at = (total: number) =>
      evaluateShipping(
        config('ORDER_TOTAL'),
        rules,
        facts({ itemsTotalMxnCents: total })
      );
    expect(at(99999)).toMatchObject({ ruleId: 1, totalMxnCents: 19900 });
    expect(at(100000)).toMatchObject({ ruleId: 2, totalMxnCents: 9900 });
  });

  it('ties: the cheapest covering rule wins, then the lowest id (favourable to the buyer)', () => {
    const rules = [
      rule(7, 12900, { zoneId: ZAC }),
      rule(5, 9900, { zoneId: ZAC }),
      rule(3, 9900, { zoneId: ZAC }),
      rule(1, 4900, { zoneId: JAL }), // cheaper, but does not cover ZAC
    ];
    expect(evaluateShipping(config('ZONE_RATE'), rules, facts())).toMatchObject(
      {
        ruleId: 3,
        totalMxnCents: 9900,
      }
    );
  });
});

describe('purchaseClass', () => {
  const ranks = [
    { id: STANDARD, rank: 10 },
    { id: BULKY, rank: 20 },
    { id: 3, rank: 15 },
  ];

  it('takes the class with the highest rank present, by rank and never by id or name', () => {
    expect(purchaseClass([STANDARD, BULKY, STANDARD], ranks)).toBe(BULKY);
    expect(purchaseClass([3, STANDARD], ranks)).toBe(3);
    expect(purchaseClass([STANDARD], ranks)).toBe(STANDARD);
  });

  it('is null with no lines or only unknown classes', () => {
    expect(purchaseClass([], ranks)).toBeNull();
    expect(purchaseClass([99], ranks)).toBeNull();
  });
});

describe('T2 · ∀ q serviceable: base + tax = total, base = round(total × 100 / 116), tax = total − base', () => {
  it('holds exactly for every rate from 0 to 100 000 cents', () => {
    const broken: number[] = [];
    for (let rate = 0; rate <= 100_000; rate += 1) {
      const outcome = evaluateShipping(
        config('FLAT_RATE'),
        [rule(1, rate)],
        facts()
      );
      const base = Math.round((rate * 100) / 116);
      const exact =
        outcome.serviceable &&
        outcome.totalMxnCents === rate &&
        outcome.baseMxnCents === base &&
        outcome.taxMxnCents === rate - base &&
        outcome.baseMxnCents + outcome.taxMxnCents === outcome.totalMxnCents;
      if (!exact) broken.push(rate);
    }
    expect(broken).toEqual([]);
  });
});

describe('progress toward free shipping (cart bar)', () => {
  const rules = [rule(1, 15000)];

  it('reports what is still missing below the threshold and 0 once it is granted', () => {
    const on = config('FLAT_RATE', {
      freeShippingActive: true,
      freeShippingThresholdMxnCents: 200000,
    });
    expect(evaluateShipping(on, rules, facts())).toMatchObject({
      code: 'STANDARD_RATE',
      freeShippingRemainingMxnCents: 15000, // 200 000 − 185 000
    });
    expect(
      evaluateShipping(on, rules, facts({ itemsTotalMxnCents: 250000 }))
    ).toMatchObject({
      code: 'FREE_SHIPPING',
      freeShippingRemainingMxnCents: 0,
    });
  });

  it('is null while the modifier is off, whatever is stored', () => {
    const off = config('FLAT_RATE', { freeShippingThresholdMxnCents: 200000 });
    expect(evaluateShipping(off, rules, facts())).toMatchObject({
      freeShippingRemainingMxnCents: null,
    });
  });
});
