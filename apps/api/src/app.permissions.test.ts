import { describe, expect, it, vi } from 'vitest';
import { buildApp } from './app';
import { loadConfig } from './config';
import type { Db, Transactional } from './services/db';

// A contract that declares one route with a permission the RBAC catalog does not have, as a typo
// or a stale entry would. The types forbid it in the real contract; the guard refuses it anyway.
vi.mock('./contract', async (original) => {
  const actual = await original<typeof import('./contract')>();
  return {
    ...actual,
    ROUTE_CONTRACTS: [
      ...actual.ROUTE_CONTRACTS,
      {
        method: 'GET',
        path: '/v1/typo',
        permission: 'orders:raed',
        request: {},
        responses: {},
      },
    ],
  };
});

const db: Db & Transactional = {
  query: async <Row>() => [] as Row[],
  ping: async () => undefined,
  transaction(work) {
    return work(this);
  },
  close: async () => undefined,
};

describe('route permissions (FC 028 T2.3)', () => {
  it('refuses to register a route whose permission is not in the catalog', async () => {
    const app = await buildApp({
      config: loadConfig({
        DB_HOST: '127.0.0.1',
        DB_USER: 'root',
        DB_NAME: 'yekora_dev',
      }),
      db,
      rate: async () => null,
      logger: false,
    });
    expect(() => app.get('/v1/typo', async () => ({}))).toThrow(
      'Route GET /v1/typo needs unknown permission orders:raed'
    );
    await app.close();
  }, 30_000);
});
