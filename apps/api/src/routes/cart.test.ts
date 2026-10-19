import type { FastifyInstance } from 'fastify';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import type { Db } from '../services/db';

const config = loadConfig({
  DB_HOST: '127.0.0.1',
  DB_USER: 'root',
  DB_NAME: 'yekora_dev',
});
const FIX = { series: 'SF43718', date: '2026-10-19', rate: '18.5000' };

/** Catalog with one tent (net 1 160 cents, 10 in stock) behind the Db port. */
function cartDb(): Db {
  const rows = [
    {
      sku: 'TENT',
      slug: 'tienda',
      name_es: 'Tienda',
      name_en: 'Tent',
      price_mxn_cents: 1160,
      stock: 10,
    },
  ];
  return {
    async query<Row>(_sql: string, params: readonly unknown[] = []) {
      const skus = (params[0] as string[] | undefined) ?? [];
      return rows.filter((row) => skus.includes(row.sku)) as Row[];
    },
    ping: async () => undefined,
    close: async () => undefined,
  };
}

let app: FastifyInstance;

async function makeApp() {
  app = await buildApp({
    config,
    db: cartDb(),
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
