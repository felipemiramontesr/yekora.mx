import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Db } from './services/db';

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

const idleDb = (): Db => ({
  query: async () => [],
  ping: async () => undefined,
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
    const db: Db = {
      query: vi.fn(async () => []),
      ping: vi.fn(async () => undefined),
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
