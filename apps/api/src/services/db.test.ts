import { beforeEach, describe, expect, it, vi } from 'vitest';

const connection = {
  beginTransaction: vi.fn(async () => undefined),
  query: vi.fn(async () => [[{ affected: 1 }], []]),
  commit: vi.fn(async () => undefined),
  rollback: vi.fn(async () => undefined),
  release: vi.fn(),
};
const pool = {
  query: vi.fn(async () => [[{ one: 1 }], []]),
  end: vi.fn(async () => undefined),
  getConnection: vi.fn(async () => connection),
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

  it('commits work done on one connection and returns its result', async () => {
    const db = createDb(config);
    const result = await db.transaction(async (tx) => {
      const rows = await tx.query<{ affected: number }>(
        'UPDATE t SET a = ?',
        [1]
      );
      await tx.query('SELECT 1');
      return rows[0].affected;
    });
    expect(result).toBe(1);
    expect(connection.query).toHaveBeenNthCalledWith(
      1,
      'UPDATE t SET a = ?',
      [1]
    );
    expect(connection.query).toHaveBeenNthCalledWith(2, 'SELECT 1', []);
    expect(connection.beginTransaction).toHaveBeenCalledOnce();
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledOnce();
    // The pool itself never ran the statements: they stayed inside the transaction.
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('rolls back and rethrows when the work fails, and still releases the connection', async () => {
    const db = createDb(config);
    await expect(
      db.transaction(async () => {
        throw new Error('insufficient stock');
      })
    ).rejects.toThrow('insufficient stock');
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledOnce();
  });
});
