/**
 * MariaDB access (FC 008, ADR 0003): a connection pool behind a two-method interface.
 *
 * Every statement is a static SQL string with `?` placeholders and a separate parameter array;
 * no ORM, no query builder, no string concatenation (OWASP A03, truth table T1.1). The
 * `scripts/checkNoRawSql.ts` guard enforces it on every `query(...)` call in apps/api/src.
 * Routes and repositories depend on {@link Db}, so tests run without a database.
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

/**
 * Creates the pooled MariaDB adapter.
 *
 * @param config - Connection settings from {@link loadConfig}.
 * @returns A {@link Db} backed by a mysql2 pool of 10 connections.
 */
export function createDb(config: DbConfig): Db {
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
    async close() {
      await pool.end();
    },
  };
}
