import type { FastifyInstance } from 'fastify';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import type { Db, Transactional } from '../services/db';

const config = loadConfig({
  DB_HOST: '127.0.0.1',
  DB_USER: 'root',
  DB_NAME: 'yekora_dev',
});
const FIX = { series: 'SF43718', date: '2026-10-19', rate: '18.5000' };

/** Shipping tables of the fake (FC 011): ZAC is a zone; no configuration unless given. */
interface ShippingTables {
  config?: { strategy_id: number; strategy: string; threshold: number | null };
  rateMxnCents?: number;
}

/**
 * Catalog with one tent (net 1 160 cents, 10 in stock, 3.8 kg boxed) behind the Db port, plus
 * the shipping tables of migration 002 answered by statement.
 */
function cartDb(shipping: ShippingTables = {}): Db & Transactional {
  const rows = [
    {
      sku: 'TENT',
      slug: 'tienda',
      name_es: 'Tienda',
      name_en: 'Tent',
      price_mxn_cents: 1160,
      stock: 10,
      weight_grams: 3800,
      length_mm: 600,
      width_mm: 200,
      height_mm: 200,
      shipping_class_id: 1,
    },
  ];
  return {
    async query<Row>(sql: string, params: readonly unknown[] = []) {
      if (sql.includes('FROM shipping_zones')) {
        return (params[0] === 'ZAC' ? [{ id: 32 }] : []) as Row[];
      }
      if (sql.includes('FROM shipping_configs')) {
        const config = shipping.config;
        return (
          config
            ? [
                {
                  strategy_id: config.strategy_id,
                  strategy: config.strategy,
                  is_free_shipping_active: config.threshold === null ? 0 : 1,
                  free_shipping_threshold_mxn_cents: config.threshold,
                },
              ]
            : []
        ) as Row[];
      }
      if (sql.includes('FROM shipping_classes')) {
        return [{ id: 1, class_rank: 10 }] as Row[];
      }
      if (sql.includes('FROM shipping_rules')) {
        return [
          {
            id: 1,
            zone_id: null,
            shipping_class_id: null,
            min_weight_grams: null,
            max_weight_grams: null,
            min_items_total_mxn_cents: null,
            max_items_total_mxn_cents: null,
            rate_mxn_cents: shipping.rateMxnCents ?? 0,
          },
        ] as Row[];
      }
      const skus = (params[0] as string[] | undefined) ?? [];
      return rows.filter((row) => skus.includes(row.sku)) as Row[];
    },
    ping: async () => undefined,
    // Runs the work on this same fake: no real transaction is needed in memory.
    transaction(work) {
      return work(this);
    },
    close: async () => undefined,
  };
}

let app: FastifyInstance;

async function makeApp(shipping: ShippingTables = {}) {
  app = await buildApp({
    config,
    db: cartDb(shipping),
    rate: async () => FIX,
    logger: false,
  });
  return app;
}

function quote(payload: unknown, url = '/v1/cart/quote') {
  return app.inject({ method: 'POST', url, payload: payload as object });
}

// Same cold-start budget as app.test.ts.
beforeAll(async () => {
  await (await makeApp()).inject('/health');
  await app.close();
}, 30_000);

afterEach(async () => {
  await app.close();
});

describe('POST /v1/cart/quote', () => {
  it('answers the F4 smoke body with a zeroed summary', async () => {
    await makeApp();
    const res = await quote({ items: [] });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      items: [],
      summary: {
        itemsBaseMxnCents: 0,
        itemsTaxMxnCents: 0,
        itemsTotalMxnCents: 0,
        shippingCode: null,
        shippingBaseMxnCents: null,
        shippingTaxMxnCents: null,
        shippingTotalMxnCents: null,
        serviceable: true,
        freeShippingRemainingMxnCents: null,
        subtotalMxnCents: 0,
        taxMxnCents: 0,
        totalMxnCents: 0,
        totalItems: 0,
        referenceUsdCents: null,
        exchangeRate: FIX,
      },
      warnings: [],
    });
  });

  it('quotes in Spanish by default and in English on request', async () => {
    await makeApp();
    const es = await quote({ items: [{ sku: 'TENT', quantity: 3 }] });
    expect(es.statusCode).toBe(200);
    expect(es.json().items[0]).toMatchObject({
      name: 'Tienda',
      lineTotalMxnCents: 3480,
      lineBaseMxnCents: 3000,
      lineTaxMxnCents: 480,
    });
    expect(es.json().summary.referenceUsdCents).toBe(188);
    const en = await quote(
      { items: [{ sku: 'TENT', quantity: 1 }] },
      '/v1/cart/quote?lang=en'
    );
    expect(en.json().items[0].name).toBe('Tent');
  });

  it('answers 200 with a warning for an unknown SKU (T1.1 row ⊤ ⊥)', async () => {
    await makeApp();
    const res = await quote({
      items: [
        { sku: 'TENT', quantity: 1 },
        { sku: 'GHOST', quantity: 1 },
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().warnings).toEqual([
      { sku: 'GHOST', code: 'unavailable' },
    ]);
    expect(res.json().summary.totalItems).toBe(1);
  });

  it.each([
    ['a zero quantity', { items: [{ sku: 'TENT', quantity: 0 }] }],
    ['a quantity over 99', { items: [{ sku: 'TENT', quantity: 100 }] }],
    ['a fractional quantity', { items: [{ sku: 'TENT', quantity: 1.5 }] }],
    ['an empty SKU', { items: [{ sku: '', quantity: 1 }] }],
    [
      'a SKU over 64 characters',
      { items: [{ sku: 'X'.repeat(65), quantity: 1 }] },
    ],
    [
      'a price sent by the client',
      { items: [{ sku: 'TENT', quantity: 1, price: 1 }] },
    ],
    ['an unknown top-level field', { items: [], total: 1 }],
    [
      'a repeated SKU',
      {
        items: [
          { sku: 'TENT', quantity: 1 },
          { sku: 'TENT', quantity: 2 },
        ],
      },
    ],
    [
      'more than 50 lines',
      {
        items: Array.from({ length: 51 }, (_, i) => ({
          sku: `S${i}`,
          quantity: 1,
        })),
      },
    ],
    ['no items', {}],
  ])('rejects %s with a 400 problem (T1.1 row ⊥)', async (_case, payload) => {
    await makeApp();
    const res = await quote(payload);
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({ status: 400, title: 'Invalid cart' });
  });

  it('rejects an unknown language', async () => {
    await makeApp();
    const res = await quote({ items: [] }, '/v1/cart/quote?lang=fr');
    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toBe('Invalid lang');
  });

  it.each([
    [
      'plain text, read as a string and refused by the schema',
      'text/plain',
      400,
    ],
    ['a media type the API does not parse', 'application/xml', 415],
  ])('refuses %s', async (_case, contentType, status) => {
    await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/cart/quote',
      headers: { 'content-type': contentType },
      payload: '<items>TENT</items>',
    });
    expect(res.statusCode).toBe(status);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('lets the site send the quote across origins, and nobody else', async () => {
    await makeApp();
    const preflight = (origin: string) =>
      app.inject({
        method: 'OPTIONS',
        url: '/v1/cart/quote',
        headers: {
          origin,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type',
        },
      });
    const site = await preflight('https://yekora.mx');
    expect(site.headers['access-control-allow-origin']).toBe(
      'https://yekora.mx'
    );
    expect(site.headers['access-control-allow-methods']).toContain('POST');
    const evil = await preflight('https://evil.example');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('limits each client to 60 quotes per minute', async () => {
    await makeApp();
    for (let i = 0; i < 60; i++) {
      expect((await quote({ items: [] })).statusCode).toBe(200);
    }
    const res = await quote({ items: [] });
    expect(res.statusCode).toBe(429);
    expect(res.headers['x-ratelimit-limit']).toBe('60');
  });
});

describe('POST /v1/cart/quote with a destination (FC 011 · T1.1)', () => {
  const tent = [{ sku: 'TENT', quantity: 2 }];
  const flat = {
    config: { strategy_id: 1, strategy: 'FLAT_RATE', threshold: null },
  };

  it('V ⊥: an empty or unavailable cart is a 400 problem, before the destination is read', async () => {
    await makeApp(flat);
    for (const items of [
      [],
      [{ sku: 'NOPE', quantity: 1 }],
      [{ sku: 'TENT', quantity: 11 }],
    ]) {
      const res = await quote({ items, destination: { stateCode: 'XYZ' } });
      expect(res.statusCode).toBe(400);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.json()).toMatchObject({
        status: 400,
        title: 'Cart cannot be quoted',
        detail: 'EMPTY_OR_UNAVAILABLE_CART',
      });
    }
  });

  it('V ⊤ D ⊥: a state that is not a zone is a 400 problem INVALID_DESTINATION', async () => {
    await makeApp(flat);
    const res = await quote({ items: tent, destination: { stateCode: 'XYZ' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      title: 'Invalid destination',
      detail: 'INVALID_DESTINATION',
    });
  });

  it('V ⊤ D ⊤ R ⊥: nothing configured yet → 200, not serviceable, zero charge (Ω option A)', async () => {
    await makeApp();
    const res = await quote({ items: tent, destination: { stateCode: 'ZAC' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary).toMatchObject({
      itemsTotalMxnCents: 2320,
      shippingCode: 'UNSERVICEABLE_DESTINATION',
      shippingBaseMxnCents: 0,
      shippingTaxMxnCents: 0,
      shippingTotalMxnCents: 0,
      serviceable: false,
      totalMxnCents: 2320,
    });
  });

  it('V ⊤ D ⊤ R ⊤: the shipping line joins the grand totals, split like a product line', async () => {
    await makeApp({ ...flat, rateMxnCents: 15000 });
    const res = await quote({
      items: tent,
      destination: { stateCode: 'ZAC', postalCode: '98612' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary).toEqual({
      itemsBaseMxnCents: 2000,
      itemsTaxMxnCents: 320,
      itemsTotalMxnCents: 2320,
      shippingCode: 'STANDARD_RATE',
      shippingBaseMxnCents: 12931,
      shippingTaxMxnCents: 2069,
      shippingTotalMxnCents: 15000,
      serviceable: true,
      freeShippingRemainingMxnCents: null,
      subtotalMxnCents: 14931,
      taxMxnCents: 2389,
      totalMxnCents: 17320,
      totalItems: 2,
      referenceUsdCents: 936, // round(17 320 / 18.5): the reference includes shipping
      exchangeRate: FIX,
    });
  });

  it('free shipping from the threshold: FREE_SHIPPING with a zero line', async () => {
    await makeApp({
      config: { strategy_id: 1, strategy: 'FLAT_RATE', threshold: 2320 },
      rateMxnCents: 15000,
    });
    const res = await quote({ items: tent, destination: { stateCode: 'ZAC' } });
    expect(res.json().summary).toMatchObject({
      shippingCode: 'FREE_SHIPPING',
      shippingTotalMxnCents: 0,
      totalMxnCents: 2320,
    });
  });

  it('validates the destination before any query: format, postal code and extra keys', async () => {
    await makeApp(flat);
    const bad = [
      { stateCode: 'zac' },
      { stateCode: 'ZA' },
      { stateCode: 'ZAC', postalCode: '9861' },
      { stateCode: 'ZAC', postalCode: 98612 },
      { stateCode: 'ZAC', shippingMxnCents: 0 }, // the browser never sends an amount
      {},
    ];
    for (const destination of bad) {
      const res = await quote({ items: tent, destination });
      expect(res.statusCode).toBe(400);
      expect(res.json().title).toBe('Invalid cart');
    }
  });

  it('keeps the products-only answer when no destination is sent (F4 smoke body)', async () => {
    await makeApp(flat);
    const res = await quote({ items: [] });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary).toMatchObject({
      shippingCode: null,
      serviceable: true,
      freeShippingRemainingMxnCents: null,
    });
  });
});

describe('POST /v1/cart/quote · progress toward free shipping', () => {
  it('tells the cart how much is missing for free shipping', async () => {
    await makeApp({
      config: { strategy_id: 1, strategy: 'FLAT_RATE', threshold: 5000 },
      rateMxnCents: 15000,
    });
    const res = await quote({
      items: [{ sku: 'TENT', quantity: 2 }],
      destination: { stateCode: 'ZAC' },
    });
    expect(res.json().summary).toMatchObject({
      shippingCode: 'STANDARD_RATE',
      freeShippingRemainingMxnCents: 2680, // 5000 − 2320
    });
  });
});
