/**
 * Seeds the real-stack E2E database (FC 026 T1.3): the catalog, stock, FIX and shipping tables
 * of e2e/fixtures/catalog.json, in one transaction (statements from scripts/lib/e2eStackSeed.ts).
 *
 * Connection from the environment, as scripts/migrateDb.ts: DB_HOST, DB_PORT (default 3306),
 * DB_USER, DB_PASSWORD, DB_NAME. It writes fictitious products, so it runs only on the CI
 * database `yekora_ci` on this machine, never on another one. Nothing secret is printed.
 *
 * CLI: `bun scripts/seedE2eStack.ts` (after `bun scripts/migrateDb.ts`).
 */
import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import { type E2eFixture, e2eStackSeed } from './lib/e2eStackSeed';
import { isLocalHost } from './lib/migrations';

const host = process.env.DB_HOST ?? '';
const database = process.env.DB_NAME ?? '';
if (database !== 'yekora_ci' || !isLocalHost(host)) {
  throw new Error(
    `seedE2eStack.ts runs only on yekora_ci on this machine, not ${database}@${host}`
  );
}

const fixture = JSON.parse(
  readFileSync('e2e/fixtures/catalog.json', 'utf8')
) as E2eFixture;
const statements = e2eStackSeed(fixture);

const connection = await mysql.createConnection({
  host,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database,
});
try {
  await connection.beginTransaction();
  for (const { sql, params } of statements) await connection.query(sql, params);
  await connection.commit();
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  await connection.end();
}
console.log(
  `[OK] E2E stack seeded: ${statements.length} statements on ${database}.`
);
