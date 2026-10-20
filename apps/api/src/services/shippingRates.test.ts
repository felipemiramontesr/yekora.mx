import { describe, expect, it } from 'vitest';
import type { Db } from './db';
import { createTableRateProvider } from './shippingRates';
import type { ShipmentRequest } from './shippingPort';

interface Tables {
  zones: Record<string, number>;
  config: {
    strategy_id: number;
    strategy: string;
    is_free_shipping_active: number;
    free_shipping_threshold_mxn_cents: number | null;
  } | null;
  rules: Array<Record<string, number | null>>;
}

/** In-memory rate tables behind the Db port; records every statement it receives. */
function tablesDb(tables: Tables) {
  const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
  const db: Db = {
    async query<Row>(sql: string, params: readonly unknown[] = []) {
      calls.push({ sql, params });
      if (sql.includes('FROM shipping_zones')) {
        const id = tables.zones[String(params[0])];
        return (id === undefined ? [] : [{ id }]) as Row[];
      }
      if (sql.includes('FROM shipping_configs')) {
        return (tables.config === null ? [] : [tables.config]) as Row[];
      }
      if (sql.includes('FROM shipping_classes')) {
        return [
          { id: 1, class_rank: 10 },
          { id: 2, class_rank: 20 },
        ] as Row[];
      }
      return tables.rules.filter((r) => r.strategy_id === params[0]) as Row[];
    },
    ping: async () => undefined,
    close: async () => undefined,
  };
  return { db, calls };
}

const rule = (over: Record<string, number | null>) => ({
  id: 1,
  strategy_id: 3,
  zone_id: null,
  shipping_class_id: null,
  min_weight_grams: null,
  max_weight_grams: null,
  min_items_total_mxn_cents: null,
  max_items_total_mxn_cents: null,
  rate_mxn_cents: 0,
  ...over,
});

const request: ShipmentRequest = {
  stateCode: 'ZAC',
  // Backpack (standard, bulky by volume) and a bulky-class item: the purchase is class 2.
  lines: [
    {
      quantity: 2,
      weightGrams: 1200,
      lengthMm: 500,
      widthMm: 300,
      heightMm: 200,
      classId: 1,
    },
    {
      quantity: 1,
      weightGrams: 3800,
      lengthMm: 600,
      widthMm: 200,
      heightMm: 200,
      classId: 2,
    },
  ],
  itemsTotalMxnCents: 370000,
};

describe('createTableRateProvider', () => {
  it('rejects a state that is not an active zone before reading any configuration (T1.1 D)', async () => {
    const { db, calls } = tablesDb({
      zones: { ZAC: 32 },
      config: null,
      rules: [],
    });
    await expect(
      createTableRateProvider(db).quote({ ...request, stateCode: 'XYZ' })
    ).resolves.toEqual({ serviceable: false, code: 'INVALID_DESTINATION' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      sql: 'SELECT id FROM shipping_zones WHERE code = ? AND is_active = 1',
      params: ['XYZ'],
    });
  });

  it('answers UNSERVICEABLE while nothing is configured (Ω option A), without reading rules', async () => {
    const { db, calls } = tablesDb({
      zones: { ZAC: 32 },
      config: null,
      rules: [],
    });
    await expect(createTableRateProvider(db).quote(request)).resolves.toEqual({
      serviceable: false,
      code: 'UNSERVICEABLE_DESTINATION',
    });
    expect(calls.map((c) => c.sql.split(' FROM ')[1]?.split(' ')[0])).toEqual([
      'shipping_zones',
      'shipping_configs',
    ]);
  });

  it('prices with the active strategy, the purchase class by rank and its chargeable weight', async () => {
    const { db, calls } = tablesDb({
      zones: { ZAC: 32 },
      config: {
        strategy_id: 3,
        strategy: 'ZONE_CLASS_RATE',
        is_free_shipping_active: 0,
        free_shipping_threshold_mxn_cents: null,
      },
      rules: [
        rule({
          id: 1,
          zone_id: 32,
          shipping_class_id: 1,
          rate_mxn_cents: 12900,
        }),
        rule({
          id: 2,
          zone_id: 32,
          shipping_class_id: 2,
          rate_mxn_cents: 29900,
        }),
        rule({ id: 3, strategy_id: 1, rate_mxn_cents: 100 }), // other strategy: never read
      ],
    });
    await expect(createTableRateProvider(db).quote(request)).resolves.toEqual({
      serviceable: true,
      code: 'STANDARD_RATE',
      strategy: 'ZONE_CLASS_RATE',
      ruleId: 2,
      totalMxnCents: 29900,
      baseMxnCents: 25776,
      taxMxnCents: 4124,
      freeShippingRemainingMxnCents: null,
    });
    // The rules of the configured strategy only, by parameter.
    expect(
      calls.find((c) => c.sql.includes('FROM shipping_rules'))?.params
    ).toEqual([3]);
  });

  it('applies free shipping from the configured threshold and weighs the purchase as one', async () => {
    const { db } = tablesDb({
      zones: { ZAC: 32 },
      config: {
        strategy_id: 4,
        strategy: 'CHARGEABLE_WEIGHT',
        is_free_shipping_active: 1,
        free_shipping_threshold_mxn_cents: 370000,
      },
      // 2 × 30 000 000 + 24 000 000 mm³ = 84 000 000 → 16 800 g chargeable (real 6200 g).
      rules: [
        rule({
          id: 4,
          strategy_id: 4,
          min_weight_grams: 0,
          max_weight_grams: 16800,
          rate_mxn_cents: 9900,
        }),
        rule({
          id: 5,
          strategy_id: 4,
          min_weight_grams: 16800,
          rate_mxn_cents: 24900,
        }),
      ],
    });
    await expect(
      createTableRateProvider(db).quote(request)
    ).resolves.toMatchObject({
      code: 'FREE_SHIPPING',
      ruleId: 5,
      totalMxnCents: 0,
    });
    await expect(
      createTableRateProvider(db).quote({
        ...request,
        itemsTotalMxnCents: 369999,
      })
    ).resolves.toMatchObject({
      code: 'STANDARD_RATE',
      ruleId: 5,
      totalMxnCents: 24900,
    });
  });

  it('sends only static SQL with placeholders, every value as a parameter', async () => {
    const { db, calls } = tablesDb({
      zones: { ZAC: 32 },
      config: {
        strategy_id: 1,
        strategy: 'FLAT_RATE',
        is_free_shipping_active: 0,
        free_shipping_threshold_mxn_cents: null,
      },
      rules: [rule({ id: 9, strategy_id: 1, rate_mxn_cents: 15000 })],
    });
    await createTableRateProvider(db).quote({
      ...request,
      stateCode: "ZAC' OR '1'='1",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).not.toContain('ZAC');
    expect(calls[0].params).toEqual(["ZAC' OR '1'='1"]);
  });
});
