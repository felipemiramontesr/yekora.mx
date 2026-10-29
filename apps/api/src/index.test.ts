import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Db, Transactional } from './services/db';

const pool = {
  query: vi.fn(async () => [[], []]),
  end: vi.fn(async () => undefined),
};
vi.mock('mysql2/promise', () => ({ default: { createPool: () => pool } }));

const { start } = await import('./index');

const env = {
  DB_HOST: '127.0.0.1',
  DB_USER: 'root',
  DB_NAME: 'yekora_dev',
  PORT: '0',
  HOST: '127.0.0.1',
};

const idleDb = (): Db & Transactional => ({
  query: async () => [],
  ping: async () => undefined,
  // Runs the work on this same fake: no real transaction is needed in memory.
  transaction(work) {
    return work(this);
  },
  close: async () => undefined,
});

// Same cold-start budget as app.test.ts; the warm-up never touches the mocked pool.
beforeAll(async () => {
  const { address, stop } = await start(env, idleDb);
  await fetch(`${address}/health`);
  await stop();
}, 30_000);

describe('start', () => {
  it('listens over HTTP with the injected database and stops cleanly', async () => {
    const db: Db & Transactional = {
      query: vi.fn(async () => []),
      ping: vi.fn(async () => undefined),
      // Runs the work on this same fake: no real transaction is needed in memory.
      transaction(work) {
        return work(this);
      },
      close: vi.fn(async () => undefined),
    };
    const { address, stop } = await start(env, () => db);
    expect(address).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const health = await fetch(`${address}/health`);
    expect(health.status).toBe(200);
    // No FIX stored and no token: the rate route degrades to 503 instead of failing.
    expect((await fetch(`${address}/v1/exchange-rate`)).status).toBe(503);

    await stop();
    expect(db.close).toHaveBeenCalledOnce();
  });

  it('uses the MariaDB pool by default', async () => {
    const { address, stop } = await start(env);
    expect((await fetch(`${address}/health`)).status).toBe(200);
    expect(pool.query).toHaveBeenCalledWith('SELECT 1');
    await stop();
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it('refuses to start with an invalid environment', async () => {
    await expect(start({ ...env, DB_NAME: 'archon' })).rejects.toThrow();
  });
});

describe('start · Mercado Pago account check (FC 019)', () => {
  const tags = (list: string[]) =>
    vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ tags: list }))
    );
  const mp = (token: string) => ({
    MP_ACCESS_TOKEN: token,
    MP_WEBHOOK_SECRET: 'mp_1',
  });
  const sandboxAppUsr = {
    ...mp('APP_USR-1'),
    MP_SANDBOX_IS_TEST_ACCOUNT: 'true',
  };
  const live = { ...mp('APP_USR-1'), PAYMENTS_MODE: 'live' };

  it.each([
    ['without Mercado Pago (T1.0)', {}],
    ['with a TEST- token in sandbox (T1.1)', mp('TEST-1')],
  ])('starts without asking Mercado Pago %s', async (_case, keys) => {
    const fetchMock = tags([]);
    const { stop } = await start({ ...env, ...keys }, idleDb, fetchMock);
    await stop();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['a test account in sandbox', sandboxAppUsr, ['test_user', 'normal']],
    ['a real account in live', live, ['normal']],
  ])(
    'starts with %s, after asking Mercado Pago once',
    async (_case, keys, list) => {
      const fetchMock = tags(list);
      const { stop } = await start({ ...env, ...keys }, idleDb, fetchMock);
      await stop();
      expect(fetchMock).toHaveBeenCalledOnce();
    }
  );

  it.each([
    [
      'a real account in sandbox',
      sandboxAppUsr,
      ['normal'],
      'UNVERIFIED_MP_TEST_ACCOUNT',
    ],
    [
      'a test account in live',
      live,
      ['test_user'],
      'TEST_ACCOUNT_REJECTED_IN_LIVE',
    ],
  ])(
    'refuses %s before opening the database',
    async (_case, keys, list, code) => {
      const makeDb = vi.fn(idleDb);
      await expect(
        start({ ...env, ...keys }, makeDb, tags(list))
      ).rejects.toThrow(code);
      expect(makeDb).not.toHaveBeenCalled();
    }
  );
});
