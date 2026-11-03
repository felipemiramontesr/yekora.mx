import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { loadConfig } from './config';
import { ROUTE_CONTRACTS } from './contract';
import { problemSchema } from './lib/problem';
import type { Db, Transactional } from './services/db';

const config = loadConfig({
  DB_HOST: '127.0.0.1',
  DB_USER: 'root',
  DB_NAME: 'yekora_dev',
});

const product = {
  sku: 'DEV-0001',
  slug: 'mochila-ligera',
  name_es: 'Mochila ligera',
  name_en: 'Light backpack',
  description_es: 'Treinta litros.',
  description_en: 'Thirty liters.',
  price_mxn_cents: 185000,
  stock: 3,
  discipline: 'senderismo',
  discipline_name_es: 'Senderismo',
  discipline_name_en: 'Hiking',
  level: 'principiante',
  level_name_es: 'Principiante',
  level_name_en: 'Beginner',
};

/** One product with one image, behind the Db port. */
const db: Db & Transactional = {
  async query<Row>(sql: string) {
    if (sql.startsWith('SELECT COUNT')) return [{ total: 1 }] as Row[];
    if (sql.startsWith('SELECT i.path')) {
      return [
        { path: '/images/products/a.webp', alt_es: 'Mochila', alt_en: 'Pack' },
      ] as Row[];
    }
    return [product] as Row[];
  },
  ping: async () => undefined,
  transaction(work) {
    return work(this);
  },
  close: async () => undefined,
};
const FIX = { series: 'SF43718', date: '2026-10-16', rate: '18.5000' };

// Pay Fastify's cold start once, with its own budget, as app.test.ts does: under the full
// parallel suite the first build can take longer than a test's 5 s.
beforeAll(async () => {
  const app = await buildApp({
    config,
    db,
    rate: async () => FIX,
    logger: false,
  });
  await app.inject('/health');
  await app.close();
}, 30_000);

/**
 * FC 028: the account needs account:self and the panel orders:read; a write on an order path
 * is a public 405 refusal; everything else stays public.
 */
function expectedPermission(route: (typeof ROUTE_CONTRACTS)[number]): string {
  if (Object.keys(route.responses).join() === '405') return 'public';
  if (route.path.startsWith('/v1/account/')) return 'account:self';
  if (route.path.startsWith('/v1/admin/')) return 'orders:read';
  return 'public';
}

// The 1:1 mapping between this registry and the routes Fastify serves is proved by
// scripts/lib/contractValidation.test.ts (ADR 0014); here, that the answers match their schemas.
describe('API contract answers (FC 027 Q03, T2.2)', () => {
  it('declares each route once, with a permission and at least one answer', () => {
    const keys = ROUTE_CONTRACTS.map(({ method, path }) => `${method} ${path}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const route of ROUTE_CONTRACTS) {
      expect(route.permission).toBe(expectedPermission(route));
      expect(Object.keys(route.responses).length).toBeGreaterThan(0);
    }
  });

  it.each([
    ['/health', 200],
    ['/v1/catalog', 200],
    ['/v1/catalog?page=0', 400],
    ['/v1/catalog/mochila-ligera?lang=en', 200],
    ['/v1/catalog/NOT_A_SLUG', 400],
    ['/v1/exchange-rate', 200],
  ])('GET %s answers %i with the declared schema', async (url, status) => {
    const app = await buildApp({
      config,
      db,
      rate: async () => FIX,
      logger: false,
    });
    const res = await app.inject(url);
    await app.close();
    const path = url
      .split('?')[0]
      .replace('mochila-ligera', ':slug')
      .replace('NOT_A_SLUG', ':slug');
    const route = ROUTE_CONTRACTS.find(
      (r) => r.method === 'GET' && r.path === path
    );
    expect(res.statusCode).toBe(status);
    expect(route?.responses[status].safeParse(res.json()).success).toBe(true);
  });

  it('describes a missing FIX as the declared problem', async () => {
    const app = await buildApp({
      config,
      db,
      rate: async () => null,
      logger: false,
    });
    const res = await app.inject('/v1/exchange-rate');
    await app.close();
    expect(res.statusCode).toBe(503);
    expect(problemSchema.safeParse(res.json()).success).toBe(true);
  });
});
