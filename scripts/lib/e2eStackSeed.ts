/**
 * Seed of the real-stack E2E lane (FC 026 T1.3): the same catalog, stock, exchange rate and
 * shipping tables the browser suites assume (e2e/fixtures/catalog.json and the emulated quote
 * API), written into a migrated MariaDB so the real API serves them. Pure: it only builds the
 * parameterized statements; scripts/seedE2eStack.ts runs them.
 *
 * @module
 */

/** One product of e2e/fixtures/catalog.json, in one language. */
interface FixtureProduct {
  sku: string;
  slug: string;
  name: string;
  description: string;
  discipline: string;
  level: string;
  priceMxnCents: number;
}

/** The part of e2e/fixtures/catalog.json the seed reads. */
export interface E2eFixture {
  /** Banxico FIX of the suites. */
  exchangeRate: { series: string; date: string; rate: string };
  /** Products by language; the same SKUs in both. */
  products: { 'es-MX': FixtureProduct[]; en: FixtureProduct[] };
}

/** One parameterized statement. */
export interface SeedStatement {
  /** Static SQL with `?` placeholders. */
  sql: string;
  /** Values bound to the placeholders, in order. */
  params: unknown[];
}

/** Units in stock per SKU, as the browser suites expect them (e2e/support/quoteApi.ts). */
export const E2E_STOCK: Readonly<Record<string, number>> = {
  'E2E-0001': 10,
  'E2E-0002': 2,
  'E2E-0003': 0,
};

/** ZONE_RATE per state in MXN cents with VAT, and the free-shipping threshold (quoteApi.ts). */
export const E2E_ZONE_RATES: Readonly<Record<string, number>> = {
  ZAC: 15_000,
  CMX: 9_900,
};

/** Free shipping from 10 000.00 MXN of items with VAT. */
export const E2E_FREE_SHIPPING_FROM = 1_000_000;

const ZONE_RATE = 2;

/**
 * Statements that leave the E2E catalog, its stock, the FIX and the shipping tables in place.
 * Running them twice gives the same database: rules are replaced, the rest is upserted.
 *
 * @param fixture - e2e/fixtures/catalog.json.
 * @returns The statements, in order.
 * @throws When a SKU has no stock in {@link E2E_STOCK} or no English twin in the fixture.
 */
export function e2eStackSeed(fixture: E2eFixture): SeedStatement[] {
  const english = new Map(fixture.products.en.map((p) => [p.sku, p]));
  const statements: SeedStatement[] = [
    {
      sql: 'INSERT INTO exchange_rates (series_id, determination_date, rate_decimal) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE rate_decimal = VALUES(rate_decimal)',
      params: [
        fixture.exchangeRate.series,
        fixture.exchangeRate.date,
        fixture.exchangeRate.rate,
      ],
    },
    {
      sql: 'INSERT INTO shipping_configs (id, active_strategy_id, is_free_shipping_active, free_shipping_threshold_mxn_cents) VALUES (1, ?, 1, ?) ON DUPLICATE KEY UPDATE active_strategy_id = VALUES(active_strategy_id), is_free_shipping_active = 1, free_shipping_threshold_mxn_cents = VALUES(free_shipping_threshold_mxn_cents)',
      params: [ZONE_RATE, E2E_FREE_SHIPPING_FROM],
    },
    { sql: 'DELETE FROM shipping_rules', params: [] },
    ...Object.entries(E2E_ZONE_RATES).map(([state, cents]) => ({
      sql: 'INSERT INTO shipping_rules (strategy_id, zone_id, rate_mxn_cents) SELECT ?, z.id, ? FROM shipping_zones z WHERE z.code = ?',
      params: [ZONE_RATE, cents, state],
    })),
  ];
  for (const es of fixture.products['es-MX']) {
    const en = english.get(es.sku);
    const stock = E2E_STOCK[es.sku];
    if (en === undefined) throw new Error(`${es.sku} has no English entry`);
    if (stock === undefined) throw new Error(`${es.sku} has no E2E stock`);
    statements.push({
      sql: "INSERT INTO products (sku, slug, category_id, experience_level_id, name_es, name_en, description_es, description_en, price_mxn_cents, stock, weight_grams, length_mm, width_mm, height_mm, shipping_class_id) SELECT ?, ?, c.id, l.id, ?, ?, ?, ?, ?, ?, 1000, 400, 300, 200, k.id FROM categories c JOIN experience_levels l ON l.slug = ? JOIN shipping_classes k ON k.slug = 'estandar' WHERE c.slug = ? ON DUPLICATE KEY UPDATE stock = VALUES(stock), reserved_stock = 0, price_mxn_cents = VALUES(price_mxn_cents), is_active = 1",
      params: [
        es.sku,
        es.slug,
        es.name,
        en.name,
        es.description,
        en.description,
        es.priceMxnCents,
        stock,
        es.level,
        es.discipline,
      ],
    });
  }
  return statements;
}
