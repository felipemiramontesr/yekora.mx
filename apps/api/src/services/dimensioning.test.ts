import { describe, expect, it } from 'vitest';
import { type PhysicalLine, purchaseWeight } from './dimensioning';

const line = (
  weightGrams: number,
  [lengthMm, widthMm, heightMm]: [number, number, number],
  quantity = 1
): PhysicalLine => ({ quantity, weightGrams, lengthMm, widthMm, heightMm });

describe('T2 · chargeable = max(Σ weight × qty, ⌈Σ L×W×H×qty / 5000⌉) over the purchase', () => {
  it('physical wins: a dense item', () => {
    // 100 × 100 × 100 mm = 1 000 000 mm³ → 200 g volumetric; 2 kg real.
    expect(purchaseWeight([line(2000, [100, 100, 100])])).toEqual({
      physicalGrams: 2000,
      volumetricGrams: 200,
      chargeableGrams: 2000,
    });
  });

  it('volumetric wins: a light, bulky item (the dev backpack)', () => {
    // 500 × 300 × 200 = 30 000 000 mm³ → 6000 g volumetric; 1.2 kg real.
    expect(purchaseWeight([line(1200, [500, 300, 200])])).toEqual({
      physicalGrams: 1200,
      volumetricGrams: 6000,
      chargeableGrams: 6000,
    });
  });

  it('a tie charges that same weight', () => {
    // 50 × 50 × 100 = 250 000 mm³ → exactly 50 g; 50 g real.
    expect(purchaseWeight([line(50, [50, 50, 100])])).toEqual({
      physicalGrams: 50,
      volumetricGrams: 50,
      chargeableGrams: 50,
    });
  });

  it('rounds the volumetric weight up only when the volume is not a multiple of 5000', () => {
    expect(purchaseWeight([line(1, [10, 10, 50])]).volumetricGrams).toBe(1); // 5000 exactly
    expect(purchaseWeight([line(1, [10, 10, 51])]).volumetricGrams).toBe(2); // 5100 → 1.02
    expect(purchaseWeight([line(1, [1, 1, 1])]).volumetricGrams).toBe(1); // 1 mm³ bills 1 g
    expect(purchaseWeight([line(1, [10, 10, 49])]).volumetricGrams).toBe(1); // 4900 → 0.98
  });

  it('multiplies by quantity and sums every line before rounding, never per product', () => {
    // 3 units of 10×10×17 = 5100 mm³ and 1 unit of 10×10×49 = 4900 mm³: 10 000 mm³ → 2 g.
    // Rounding per line would bill 2 + 1 = 3 g, and per unit 1+1+1 + 1 = 4 g.
    const lines = [line(1, [10, 10, 17], 3), line(1, [10, 10, 49])];
    expect(purchaseWeight(lines)).toEqual({
      physicalGrams: 4,
      volumetricGrams: 2,
      chargeableGrams: 4,
    });
  });

  it('weighs the dev catalog mix as one shipment', () => {
    const backpack = line(1200, [500, 300, 200], 2); // 60 000 000 mm³, 2400 g
    const harness = line(450, [300, 250, 100]); // 7 500 000 mm³, 450 g
    const shoes = line(900, [330, 220, 130], 3); // 28 314 000 mm³, 2700 g
    expect(purchaseWeight([backpack, harness, shoes])).toEqual({
      physicalGrams: 5550,
      volumetricGrams: 19163, // ⌈95 814 000 / 5000⌉ = ⌈19 162.8⌉
      chargeableGrams: 19163,
    });
  });

  it('is zero for an empty purchase', () => {
    expect(purchaseWeight([])).toEqual({
      physicalGrams: 0,
      volumetricGrams: 0,
      chargeableGrams: 0,
    });
  });

  it('stays exact beyond 2^53 mm³ of volume and refuses a weight a number cannot hold', () => {
    // 99 units of 2 m × 2 m × 2 m: 7.92e11 mm³, still far below 2^53, computed exactly.
    expect(
      purchaseWeight([line(1, [2000, 2000, 2000], 99)]).volumetricGrams
    ).toBe(158_400_000);
    // A corrupt row near the INT UNSIGNED limit cannot be priced: throw, never round.
    const huge = line(1, [4_294_967_295, 4_294_967_295, 4_294_967_295], 99);
    expect(() => purchaseWeight([huge])).toThrow(RangeError);
  });
});
