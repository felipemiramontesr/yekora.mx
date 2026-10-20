import type { FastifyInstance } from 'fastify';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app';
import { loadConfig } from './config';
import type { ProductRow } from './services/catalog';
import type { Db } from './services/db';
import type { CurrentRate } from './services/exchangeRate';

const config = loadConfig({
  DB_HOST: '127.0.0.1',
  DB_USER: 'root',
  DB_NAME: 'yekora_dev',
});
const FIX: CurrentRate = {
  series: 'SF43718',
  date: '2026-10-16',
  rate: '18.5000',
};

const tent: ProductRow = {
  sku: 'DEV-0002',
  slug: 'tienda-expedicion',
  name_es: 'Tienda de expedición',
  name_en: 'Expedition tent',
  description_es: 'Cuatro estaciones.',
  description_en: 'Four seasons.',
  price_mxn_cents: 485000,
  stock: 0,
  discipline: 'montana',
  discipline_name_es: 'Montaña',
  discipline_name_en: 'Mountaineering',
  level: 'expedicion',
  level_name_es: 'Expedición',
  level_name_en: 'Expedition',
};
const image = {
  path: '/images/products/tent.webp',
  alt_es: 'Tienda',
  alt_en: 'Tent',
};

/** In-memory catalog behind the Db port: one product with one image. */
function catalogDb(products: ProductRow[] = [tent]): Db {
  return {
    async query<Row>(sql: string, params: readonly unknown[] = []) {
      if (sql.startsWith('SELECT COUNT'))
        return [{ total: products.length }] as Row[];
      if (sql.startsWith('SELECT i.path')) return [image] as Row[];
      if (sql.includes('WHERE p.slug = ?')) {
        return products.filter((row) => row.slug === params[0]) as Row[];
      }
      return products as Row[];
    },
    ping: async () => undefined,
    close: async () => undefined,
  };
}

let app: FastifyInstance;

async function makeApp(
  db: Db = catalogDb(),
  rate: () => Promise<CurrentRate | null> = async () => FIX,
  logger = false
) {
  app = await buildApp({ config, db, rate, logger });
  return app;
}

// Pay Fastify's cold start (plugin loading, first route compile) once, with its own budget, so
// a loaded machine or CI runner cannot time out the first test while each test keeps 5 s.
beforeAll(async () => {
  await (await makeApp()).inject('/health');
  await app.close();
}, 30_000);

afterEach(async () => {
  await app.close();
});

describe('GET /health', () => {
  it('reports the version, the deployed SHA and the database', async () => {
    const res = await (await makeApp()).inject('/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'ok',
      version: '0.6.1',
      sha: 'dev',
      db: 'connected',
    });
  });

  it('answers 503 degraded when the database is unreachable', async () => {
    const db = {
      ...catalogDb(),
      ping: vi.fn(async () => Promise.reject(new Error('down'))),
    };
    const res = await (await makeApp(db)).inject('/health');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'degraded', db: 'unreachable' });
  });

  it('sends the Helmet security headers', async () => {
    const res = await (await makeApp()).inject('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['content-security-policy']).toBeDefined();
  });
});

describe('CORS', () => {
  it('allows the public site', async () => {
    const res = await (
      await makeApp()
    ).inject({
      url: '/health',
      headers: { origin: 'https://yekora.mx' },
    });
    expect(res.headers['access-control-allow-origin']).toBe(
      'https://yekora.mx'
    );
  });

  it('does not allow any other origin', async () => {
    const res = await (
      await makeApp()
    ).inject({
      url: '/health',
      headers: { origin: 'https://evil.example' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('GET /v1/catalog', () => {
  it('lists products in Spanish by default with the USD reference and the FIX used', async () => {
    const res = await (await makeApp()).inject('/v1/catalog');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      items: [
        {
          sku: 'DEV-0002',
          slug: 'tienda-expedicion',
          name: 'Tienda de expedición',
          description: 'Cuatro estaciones.',
          discipline: 'montana',
          disciplineName: 'Montaña',
          level: 'expedicion',
          levelName: 'Expedición',
          priceMxnCents: 485000,
          priceUsdCents: 26216,
          inStock: false,
        },
      ],
      page: 1,
      pageSize: 24,
      total: 1,
      exchangeRate: FIX,
    });
  });

  it('answers in English, honoring filters and paging', async () => {
    const res = await (
      await makeApp()
    ).inject(
      '/v1/catalog?lang=en&discipline=montana&level=expedicion&sort=price_asc&page=2&pageSize=12'
    );
    expect(res.json()).toMatchObject({
      items: [
        {
          name: 'Expedition tent',
          description: 'Four seasons.',
          disciplineName: 'Mountaineering',
          levelName: 'Expedition',
        },
      ],
      page: 2,
      pageSize: 12,
    });
  });

  it('is an empty, normal answer while the catalog is empty, in MXN only without a FIX', async () => {
    const res = await (
      await makeApp(catalogDb([]), async () => null)
    ).inject('/v1/catalog');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      items: [],
      page: 1,
      pageSize: 24,
      total: 0,
      exchangeRate: null,
    });
  });

  it('shows no USD price when there is no FIX', async () => {
    const res = await (
      await makeApp(catalogDb(), async () => null)
    ).inject('/v1/catalog');
    expect(res.json().items[0].priceUsdCents).toBeNull();
  });

  it.each([
    'discipline=Montana',
    "discipline=x' OR 1=1 --",
    'sort=random',
    'lang=fr',
    'page=0',
    'pageSize=49',
  ])('rejects %s with a 400 problem', async (query) => {
    const res = await (await makeApp()).inject(`/v1/catalog?${query}`);
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({ status: 400, title: 'Invalid query' });
  });
});

describe('GET /v1/catalog/:slug', () => {
  it('returns the product with its images in Spanish', async () => {
    const res = await (await makeApp()).inject('/v1/catalog/tienda-expedicion');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      name: 'Tienda de expedición',
      priceUsdCents: 26216,
      images: [{ path: '/images/products/tent.webp', alt: 'Tienda' }],
      exchangeRate: FIX,
    });
  });

  it('returns the product in English, in MXN only without a FIX', async () => {
    const res = await (
      await makeApp(catalogDb(), async () => null)
    ).inject('/v1/catalog/tienda-expedicion?lang=en');
    expect(res.json()).toMatchObject({
      name: 'Expedition tent',
      priceUsdCents: null,
      images: [{ alt: 'Tent' }],
      exchangeRate: null,
    });
  });

  it.each([
    '/v1/catalog/Tienda_Expedicion',
    '/v1/catalog/tienda-expedicion?lang=fr',
  ])('rejects %s with a 400 problem', async (url) => {
    const res = await (await makeApp()).inject(url);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ status: 400, title: 'Invalid request' });
  });

  it('answers 404 for an unknown product', async () => {
    const res = await (await makeApp()).inject('/v1/catalog/no-existe');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      status: 404,
      title: 'Product not found',
    });
  });
});

describe('GET /v1/exchange-rate', () => {
  it('returns the FIX in use', async () => {
    const res = await (await makeApp()).inject('/v1/exchange-rate');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(FIX);
  });

  it('answers 503 while no FIX has ever been stored', async () => {
    const res = await (
      await makeApp(catalogDb(), async () => null)
    ).inject('/v1/exchange-rate');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      status: 503,
      title: 'Exchange rate unavailable',
    });
  });
});

describe('errors', () => {
  it('answers 404 problem+json for an unknown route', async () => {
    const res = await (await makeApp()).inject('/v1/nope');
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toEqual({
      type: 'about:blank',
      title: 'Not found',
      status: 404,
    });
  });

  it.each([
    ['an unexpected failure', new Error('connect ECONNREFUSED 10.0.0.5:3306')],
    [
      'an upstream 5xx',
      Object.assign(new Error('pool exhausted'), { statusCode: 502 }),
    ],
  ])('hides %s behind a generic 500', async (_case, failure) => {
    const db = {
      ...catalogDb(),
      query: async () => {
        throw failure;
      },
    };
    const res = await (await makeApp(db as Db)).inject('/v1/catalog');
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      type: 'about:blank',
      title: 'Internal error',
      status: 500,
    });
    expect(res.body).not.toContain('ECONNREFUSED');
    expect(res.body).not.toContain('pool');
  });

  it('rate-limits each client to 120 requests per minute with a 429 problem', async () => {
    await makeApp();
    for (let i = 0; i < 120; i++) {
      expect((await app.inject('/health')).statusCode).toBe(200);
    }
    const res = await app.inject('/health');
    expect(res.statusCode).toBe(429);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({ status: 429 });
  });

  it('logs JSON with the authorization and cookie headers redacted', async () => {
    const write = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    await (
      await makeApp(catalogDb(), async () => FIX, true)
    ).inject({
      url: '/health',
      headers: { authorization: 'Bearer s3cret', cookie: 'sid=s3cret' },
    });
    const logged = write.mock.calls.map(([chunk]) => String(chunk)).join('');
    write.mockRestore();
    expect(logged).toContain('"url":"/health"');
    expect(logged).not.toContain('s3cret');
  });
});
