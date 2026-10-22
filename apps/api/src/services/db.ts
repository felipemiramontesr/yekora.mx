/**
 * MariaDB access (FC 008, ADR 0003): a connection pool behind a two-method interface.
 *
 * Every statement is a static SQL string with `?` placeholders and a separate parameter array;
 * no ORM, no query builder, no string concatenation (OWASP A03, truth table T1.1). The
 * `scripts/checkNoRawSql.ts` guard enforces it on every `query(...)` call in apps/api/src.
 * Routes and repositories depend on {@link Db}, so tests run without a database.
 * FC 012: work that must commit or roll back as a whole (stock reservation and the order it
 * belongs to, a payment and its order transition) runs through {@link Transactional}, on one
 * pooled connection.
 *
 * @module
 */
import mysql from 'mysql2/promise';
import type { DbConfig } from '../config';

/** Minimal database port used by the repositories. */
export interface Db {
  /**
   * Runs one parameterized statement.
   *
   * @param sql - Static SQL text with `?` placeholders.
   * @param params - Values bound to the placeholders, in order.
   * @returns The result rows.
   */
  query<Row>(sql: string, params?: readonly unknown[]): Promise<Row[]>;
  /** Checks the connection (used by /health). */
  ping(): Promise<void>;
  /** Closes the pool (graceful shutdown). */
  close(): Promise<void>;
}

/** One connection inside a transaction: the same parameterized `query` as {@link Db}. */
export type TxQuery = Pick<Db, 'query'>;

/** A database that can run all-or-nothing work. */
export interface Transactional {
  /**
   * Runs `work` in one transaction on one connection: commits when it resolves, rolls back
   * when it throws (and rethrows), and always returns the connection to the pool.
   *
   * @param work - Statements to run atomically.
   * @returns What `work` returned.
   */
  transaction<T>(work: (tx: TxQuery) => Promise<T>): Promise<T>;
}

/**
 * Creates the pooled MariaDB adapter.
 *
 * @param config - Connection settings from {@link loadConfig}.
 * @returns A {@link Db} with transactions, backed by a mysql2 pool of 10 connections.
 */
export function createDb(config: DbConfig): Db & Transactional {
  const pool = mysql.createPool({
    ...config,
    connectionLimit: 10,
    charset: 'utf8mb4',
    // DECIMAL columns arrive as strings unless asked: the FIX keeps its exact 4 decimals.
    decimalNumbers: false,
    timezone: 'Z',
  });
  return {
    async query<Row>(sql: string, params: readonly unknown[] = []) {
      const [rows] = await pool.query(sql, params as unknown[]);
      return rows as Row[];
    },
    async ping() {
      await pool.query('SELECT 1');
    },
    async transaction(work) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const result = await work({
          async query<Row>(sql: string, params: readonly unknown[] = []) {
            const [rows] = await connection.query(sql, params as unknown[]);
            return rows as Row[];
          },
        });
        await connection.commit();
        connection.release();
        return result;
      } catch (error) {
        // Release in both paths without `finally`: the connection goes back to the pool either way.
        await connection.rollback();
        connection.release();
        throw error;
      }
    },
    async close() {
      await pool.end();
    },
  };
}
