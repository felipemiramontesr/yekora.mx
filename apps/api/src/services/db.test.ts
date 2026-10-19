import { beforeEach, describe, expect, it, vi } from 'vitest';

const pool = {
  query: vi.fn(async () => [[{ one: 1 }], []]),
  end: vi.fn(async () => undefined),
};
const createPool = vi.fn(() => pool);
vi.mock('mysql2/promise', () => ({ default: { createPool } }));

const { createDb } = await import('./db');

const config = {
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: '',
  database: 'yekora_dev',
};

describe('createDb', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens a utf8mb4 pool that keeps DECIMAL exact and dates in UTC', () => {
    createDb(config);
    expect(createPool).toHaveBeenCalledWith({
      ...config,
      connectionLimit: 10,
      charset: 'utf8mb4',
      decimalNumbers: false,
      timezone: 'Z',
    });
  });

  it('passes the SQL and its parameters separately and returns the rows', async () => {
    const db = createDb(config);
    await expect(db.query('SELECT ? AS one', [1])).resolves.toEqual([
      { one: 1 },
    ]);
    expect(pool.query).toHaveBeenCalledWith('SELECT ? AS one', [1]);
  });

  it('binds an empty parameter list by default', async () => {
    await createDb(config).query('SELECT 1');
    expect(pool.query).toHaveBeenCalledWith('SELECT 1', []);
  });

  it('pings with SELECT 1 and closes the pool', async () => {
    const db = createDb(config);
    await db.ping();
    expect(pool.query).toHaveBeenCalledWith('SELECT 1');
    await db.close();
    expect(pool.end).toHaveBeenCalledOnce();
  });
});
