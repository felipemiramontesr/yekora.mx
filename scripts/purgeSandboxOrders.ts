/**
 * Purges the sandbox orders before going live (FC 027 T2.1; logic in scripts/lib/sandboxPurge.ts).
 *
 * Connection from the environment, as scripts/migrateDb.ts: DB_HOST, DB_PORT (default 3306),
 * DB_USER, DB_PASSWORD, DB_NAME. It is a dry run unless `--execute` is given, and either way it
 * prints only counts and order numbers, never a secret or personal data.
 *
 * CLI: `bun scripts/purgeSandboxOrders.ts --all-test [--execute]`
 *   or `bun scripts/purgeSandboxOrders.ts --orders YEK-2026-XXXXXXXX,… [--execute]`
 * exit 0 = purged (or counted) · exit 1 = refused, nothing deleted.
 */
import mysql from 'mysql2/promise';
import type { TxQuery } from '../apps/api/src/services/db';
import { purgeSandboxOrders, type PurgeSelection } from './lib/sandboxPurge';

const args = process.argv.slice(2);
const listed = args[args.indexOf('--orders') + 1];
let selection: PurgeSelection | null = null;
if (args.includes('--all-test')) selection = { kind: 'all-test' };
else if (args.includes('--orders') && listed !== undefined)
  selection = { kind: 'orders', orderNumbers: listed.split(',') };
if (selection === null) {
  console.error(
    'Usage: bun scripts/purgeSandboxOrders.ts --all-test | --orders YEK-…,YEK-… [--execute]'
  );
  process.exit(1);
}
const dryRun = !args.includes('--execute');

const connection = await mysql.createConnection({
  host: process.env.DB_HOST ?? '',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? '',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? '',
});
const tx: TxQuery = {
  async query<Row>(sql: string, params: readonly unknown[] = []) {
    const [rows] = await connection.query(sql, params as unknown[]);
    return rows as Row[];
  },
};
try {
  const outcome = await purgeSandboxOrders(
    {
      async transaction(work) {
        await connection.beginTransaction();
        try {
          const result = await work(tx);
          await connection.commit();
          return result;
        } catch (error) {
          await connection.rollback();
          throw error;
        }
      },
    },
    selection,
    { dryRun }
  );
  if (!outcome.ok) {
    console.error(
      `[FAIL] purge refused (${outcome.code}), nothing deleted: ${outcome.orderNumbers.join(', ') || '—'}`
    );
    process.exitCode = 1;
  } else {
    console.log(
      `[OK] ${dryRun ? 'dry run, would delete' : 'deleted'}: ${outcome.orders} orders, ${outcome.items} lines, ${outcome.events} payment events · ${outcome.soldUnits} units left stock through paid test orders (not restored)`
    );
  }
} finally {
  await connection.end();
}
