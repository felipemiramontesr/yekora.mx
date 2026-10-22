/**
 * Database migrator (FC 008 F1, DB_LAW, truth table T1.3).
 *
 * Applies the canonical migrations of migrations/ in order and records each one in
 * `schema_migrations` with its SHA-256. A second run skips everything (idempotent). A file that
 * changed after being applied aborts the run before touching anything. The same script runs
 * locally and, in production, on the migrations runner after the encrypted backup (F4).
 *
 * Connection from the environment (Bun loads .env.local): DB_HOST, DB_PORT (default 3306),
 * DB_USER, DB_PASSWORD, DB_NAME. Nothing secret is ever printed.
 *
 * CLI:
 *   bun scripts/migrateDb.ts              apply pending migrations
 *   bun scripts/migrateDb.ts --plan       read-only: print `[PLAN] tables=<n>` and
 *                                         `[PLAN] pending=<n>`, fail on tampering; changes nothing
 *                                         (db-migrations.yml decides the backup with it)
 *   bun scripts/migrateDb.ts --target <file>   apply only that migration, refusing if an
 *                                         earlier one is pending (production, one per run;
 *                                         combinable with --plan)
 *   bun scripts/migrateDb.ts --seed-dev   also load migrations/seed_dev.sql (localhost only)
 *   bun scripts/migrateDb.ts --down 001   run 001_down.sql and unregister 001 (localhost only)
 *
 * After a run that is not `--plan`, each migration of the run (the target, or every one) that has a
 * `NNN_verify.sql` prints its aggregate counters as `[VERIFY] NNN name=value …` (FC 015 §4), whether it
 * was applied now or found registered. The workflow summary shows those lines.
 *
 * @module
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import mysql from 'mysql2/promise';
import {
  decide,
  formatCounters,
  isLocalHost,
  isYekoraDatabase,
  MIGRATION_NAME,
  migrationChecksum,
  pendingOrder,
  stepsToApply,
  verifyFileFor,
} from './lib/migrations';

const MIGRATIONS_DIR = join(process.cwd(), 'migrations');

const REGISTRY = `CREATE TABLE IF NOT EXISTS schema_migrations (
  filename VARCHAR(255) NOT NULL,
  checksum_sha256 CHAR(64) NOT NULL,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (filename)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

/** Reads a required variable; fails with its name only, never its value. */
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (see .env.local)`);
  return value;
}

/** Refuses development-only actions anywhere but this machine. */
function assertLocal(host: string, action: string): void {
  if (!isLocalHost(host)) {
    throw new Error(
      `${action} only runs against localhost, never against ${host}`
    );
  }
}

/**
 * Applied migrations by file name. `--plan` changes nothing, not even the registry table, so on
 * a fresh database it reads an empty registry instead of creating one.
 */
async function readRegistry(
  connection: mysql.Connection,
  planOnly: boolean
): Promise<Map<string, string>> {
  const [[{ hasRegistry }]] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS hasRegistry FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations'"
  );
  if (planOnly && Number(hasRegistry) === 0) return new Map();
  if (!planOnly) await connection.query(REGISTRY);
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    'SELECT filename, checksum_sha256 FROM schema_migrations'
  );
  return new Map(
    rows.map((row) => [String(row.filename), String(row.checksum_sha256)])
  );
}

/** Prints the verification counters of each migration that has a NNN_verify.sql (read-only). */
async function printCounters(
  connection: mysql.Connection,
  migrations: readonly string[]
): Promise<void> {
  for (const migration of migrations) {
    const file = join(MIGRATIONS_DIR, verifyFileFor(migration));
    if (!existsSync(file)) continue;
    const [[counters]] = await connection.query<mysql.RowDataPacket[]>(
      readFileSync(file, 'utf8')
    );
    console.log(formatCounters(migration, counters));
  }
}

/** Runs NNN_down.sql and unregisters migration NNN (localhost only, checked by the caller). */
async function rollback(
  connection: mysql.Connection,
  number: string
): Promise<void> {
  if (!/^\d{3}$/.test(number)) throw new Error('--down needs a 3-digit number');
  await connection.query(
    readFileSync(join(MIGRATIONS_DIR, `${number}_down.sql`), 'utf8')
  );
  // `\_` makes the underscore literal in LIKE: 001_ matches 001_… only.
  await connection.query(
    'DELETE FROM schema_migrations WHERE filename LIKE ?',
    [String.raw`${number}\_%`]
  );
  console.log(`[OK] rolled back ${number}`);
}

/**
 * The migration named by `--target <file>`, or undefined. The name is checked against the
 * canonical pattern before any connection, so nothing else ever reaches the file system or SQL.
 */
function targetArgument(args: readonly string[]): string | undefined {
  const index = args.indexOf('--target');
  if (index === -1) return undefined;
  const target = args[index + 1] ?? '';
  if (!MIGRATION_NAME.test(target)) {
    throw new Error(
      `--target must be NNN_V<version>_FC<nnn>-F<n>_<YYYYMMDD>_<description>.sql, got "${target}"`
    );
  }
  return target;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const host = requiredEnv('DB_HOST');
  const database = requiredEnv('DB_NAME');
  if (!isYekoraDatabase(database)) {
    throw new Error(`DB_NAME must be a Yekora database, refusing ${database}`);
  }
  const planOnly = args.includes('--plan');
  const target = targetArgument(args);
  // Development-only actions are refused before any connection is even opened.
  if (args.includes('--down')) assertLocal(host, 'Rollback');
  if (args.includes('--seed-dev')) assertLocal(host, 'The development seed');
  const connection = await mysql.createConnection({
    host,
    port: Number(process.env.DB_PORT ?? 3306),
    user: requiredEnv('DB_USER'),
    // Empty is valid locally (XAMPP root default); production always has a secret.
    password: process.env.DB_PASSWORD ?? '',
    database,
    multipleStatements: true,
    charset: 'utf8mb4',
  });
  try {
    const [[{ tables }]] = await connection.query<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS tables FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()'
    );
    const registry = await readRegistry(connection, planOnly);

    const downIndex = args.indexOf('--down');
    if (downIndex >= 0) {
      await rollback(connection, args[downIndex + 1] ?? '');
      return;
    }

    const files = pendingOrder(readdirSync(MIGRATIONS_DIR));
    const plan = files.map((file) => {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      const checksum = migrationChecksum(sql);
      return {
        file,
        sql,
        checksum,
        decision: decide(checksum, registry.get(file)),
      };
    });
    // T1.3 · R: check every file before applying any of them.
    const tampered = plan.filter((step) => step.decision === 'tampered');
    if (tampered.length > 0) {
      throw new Error(
        `checksum mismatch, applied migrations were edited: ${tampered.map((s) => s.file).join(', ')}`
      );
    }
    const toApply = stepsToApply(plan, target);
    if (planOnly) {
      for (const step of plan)
        console.log(`[PLAN] ${step.decision} ${step.file}`);
      if (target) console.log(`[PLAN] target=${target}`);
      console.log(`[PLAN] tables=${Number(tables)}`);
      console.log(`[PLAN] pending=${toApply.length}`);
      return;
    }
    if (toApply.length === 0) {
      console.log('[SKIP] nothing to apply (already applied, same checksum)');
    }
    for (const step of toApply) {
      await connection.query(step.sql);
      await connection.query(
        'INSERT INTO schema_migrations (filename, checksum_sha256) VALUES (?, ?)',
        [step.file, step.checksum]
      );
      console.log(`[APPLY] ${step.file}`);
    }

    if (args.includes('--seed-dev')) {
      await connection.query(
        readFileSync(join(MIGRATIONS_DIR, 'seed_dev.sql'), 'utf8')
      );
      console.log('[SEED] seed_dev.sql (local development data)');
    }
    await printCounters(
      connection,
      target === undefined ? plan.map((step) => step.file) : [target]
    );
    console.log(
      `[OK] migrations: ${toApply.length} applied, ${plan.length - toApply.length} not applied by this run.`
    );
  } finally {
    await connection.end();
  }
}

try {
  await main();
} catch (error: unknown) {
  console.error(
    `[FAIL] ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
}
