/**
 * Encrypted backup and restore rehearsal (FC 008 F1: RTO target < 15 min, measured here).
 *
 * The backup is byte-compatible with the production migrations workflow and Archon's:
 * `mysqldump --single-transaction --routines --triggers | gzip | openssl enc -aes-256-cbc
 * -pbkdf2 -salt`. The restore is its exact inverse. `--rehearse` runs both against local
 * databases, then compares every table's row count between source and restored copy and prints
 * the timings. That measurement is the RTO evidence.
 *
 * Environment (Bun loads .env.local): DB_HOST (localhost only), DB_PORT, DB_USER, DB_PASSWORD,
 * DB_NAME, RESTORE_DB_NAME (scratch database, must differ from DB_NAME),
 * DB_BACKUP_ENCRYPTION_KEY, MYSQL_BIN (folder with mysql and mysqldump, e.g. C:\xampp\mysql\bin),
 * OPENSSL_BIN (openssl executable, e.g. C:\Program Files\Git\usr\bin\openssl.exe).
 * Executables come from explicit paths, never from PATH. Passwords travel in the child
 * environment (MYSQL_PWD, -pass env:), never on the command line.
 *
 * CLI:
 *   bun scripts/restoreDbBackup.ts --rehearse
 *   bun scripts/restoreDbBackup.ts --from <backup.sql.gz.enc> [--expect-tables <n>]
 *
 * `--from` (FC 009 F0 · K-12) restores a backup downloaded from the production migrations
 * workflow into RESTORE_DB_NAME on localhost and times it: the real RTO drill. Its key comes from
 * RESTORE_BACKUP_KEY, a variable Ω sets for that one command from a hidden prompt, so the
 * production key never sits in .env.local next to the local rehearsal key.
 *
 * @module
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import mysql from 'mysql2/promise';
import { isLocalHost, isYekoraDatabase } from './lib/migrations';

/** Reads a required variable; fails with its name only, never its value. */
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (see .env.local)`);
  return value;
}

/** Value following a flag, or undefined when the flag is absent. */
function flagValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : (process.argv[index + 1] ?? '');
}

const fromFile = flagValue('--from');
const host = requiredEnv('DB_HOST');
const port = process.env.DB_PORT ?? '3306';
const user = requiredEnv('DB_USER');
// Empty is valid locally (XAMPP root default).
const password = process.env.DB_PASSWORD ?? '';
const source = requiredEnv('DB_NAME');
const target = requiredEnv('RESTORE_DB_NAME');
const mysqlBin = requiredEnv('MYSQL_BIN');
const openssl = requiredEnv('OPENSSL_BIN');
const childEnv = {
  ...process.env,
  MYSQL_PWD: password,
  // A production backup is opened with the production key, never with the local one.
  BACKUP_KEY: requiredEnv(
    fromFile === undefined ? 'DB_BACKUP_ENCRYPTION_KEY' : 'RESTORE_BACKUP_KEY'
  ),
};
const connectionArgs = ['-h', host, '-P', port, '-u', user];

/** Waits for a child process and turns a non-zero exit into an error naming the tool. */
function exited(name: string, child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${name} exited with code ${code}`))
    );
  });
}

/** mysqldump | gzip | openssl enc → file. Same flags as the production workflow. */
async function backup(file: string): Promise<void> {
  const dump = spawn(
    join(mysqlBin, 'mysqldump'),
    [
      ...connectionArgs,
      '--single-transaction',
      '--routines',
      '--triggers',
      source,
    ],
    { env: childEnv, stdio: ['ignore', 'pipe', 'inherit'] }
  );
  const encrypt = spawn(
    openssl,
    [
      'enc',
      '-aes-256-cbc',
      '-pbkdf2',
      '-salt',
      '-pass',
      'env:BACKUP_KEY',
      '-out',
      file,
    ],
    { env: childEnv, stdio: ['pipe', 'inherit', 'inherit'] }
  );
  await Promise.all([
    pipeline(dump.stdout!, createGzip(), encrypt.stdin!),
    exited('mysqldump', dump),
    exited('openssl', encrypt),
  ]);
  if (statSync(file).size < 1024)
    throw new Error('backup is suspiciously small (< 1 KB)');
}

/** openssl enc -d | gunzip | mysql → target database. Exact inverse of backup(). */
async function restore(file: string): Promise<void> {
  const decrypt = spawn(
    openssl,
    [
      'enc',
      '-d',
      '-aes-256-cbc',
      '-pbkdf2',
      '-pass',
      'env:BACKUP_KEY',
      '-in',
      file,
    ],
    { env: childEnv, stdio: ['ignore', 'pipe', 'inherit'] }
  );
  const load = spawn(join(mysqlBin, 'mysql'), [...connectionArgs, target], {
    env: childEnv,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  await Promise.all([
    pipeline(decrypt.stdout!, createGunzip(), load.stdin!),
    exited('openssl', decrypt),
    exited('mysql', load),
  ]);
}

/** Row count of every base table of a schema, by table name. */
async function rowCounts(
  connection: mysql.Connection,
  schema: string
): Promise<Map<string, number>> {
  const [tables] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
    [schema]
  );
  const totals = await Promise.all(
    tables.map(async ({ name }) => {
      const [[row]] = await connection.query<mysql.RowDataPacket[]>(
        'SELECT COUNT(*) AS total FROM ??.??',
        [schema, name]
      );
      return [String(name), Number(row.total)] as const;
    })
  );
  return new Map(totals);
}

/** Local server, scratch database distinct from the source, Yekora databases only. */
function assertSafeTargets(): void {
  if (!isLocalHost(host))
    throw new Error(`restores only run on localhost, not ${host}`);
  if (target === source)
    throw new Error('RESTORE_DB_NAME must differ from DB_NAME');
  // The local server is shared with other projects: only Yekora databases are ever touched.
  if (!isYekoraDatabase(source) || !isYekoraDatabase(target)) {
    throw new Error(
      'DB_NAME and RESTORE_DB_NAME must both be Yekora databases'
    );
  }
}

/** Opens a server connection and recreates the empty scratch database. */
async function freshTarget(): Promise<mysql.Connection> {
  const connection = await mysql.createConnection({
    host,
    port: Number(port),
    user,
    password,
  });
  await connection.query('DROP DATABASE IF EXISTS ??', [target]);
  await connection.query(
    'CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
    [target]
  );
  return connection;
}

const seconds = (ms: number) => (ms / 1000).toFixed(1);

/**
 * K-12 drill: restores a downloaded production backup into the scratch database and times it.
 * The file must decrypt with the production key and load without errors; with
 * `--expect-tables` the restored copy must have exactly that many tables.
 */
async function restoreFrom(file: string): Promise<void> {
  assertSafeTargets();
  const size = statSync(file).size;
  const expectTables = flagValue('--expect-tables');
  const connection = await freshTarget();
  try {
    const started = Date.now();
    await restore(file);
    const restored = Date.now();
    const counts = await rowCounts(connection, target);
    if (expectTables !== undefined && counts.size !== Number(expectTables)) {
      throw new Error(
        `restored ${counts.size} tables, expected ${expectTables}`
      );
    }
    const rows = [...counts].map(([table, total]) => `${table}=${total}`);
    const detail = rows.length > 0 ? ' (' + rows.join(', ') + ')' : '';
    console.log(
      `[OK] backup decrypted and loaded into ${target}: ${counts.size} tables${detail}.`
    );
    console.log(
      `[RTO] decrypt + restore ${seconds(restored - started)} s (target < 900 s) · backup size ${size} bytes`
    );
  } finally {
    await connection.end();
  }
}

async function rehearse(): Promise<void> {
  assertSafeTargets();
  const connection = await freshTarget();
  const workDir = mkdtempSync(join(tmpdir(), 'yekora-restore-'));
  const file = join(workDir, `backup_${source}.sql.gz.enc`);
  try {
    const started = Date.now();
    await backup(file);
    const backedUp = Date.now();
    await restore(file);
    const restored = Date.now();

    const expected = await rowCounts(connection, source);
    const actual = await rowCounts(connection, target);
    const mismatches = [...expected].filter(
      ([table, rows]) => actual.get(table) !== rows
    );
    if (
      expected.size === 0 ||
      mismatches.length > 0 ||
      actual.size !== expected.size
    ) {
      throw new Error(`restored copy differs: ${JSON.stringify(mismatches)}`);
    }
    console.log(
      `[OK] ${expected.size} tables, same row counts in ${source} and ${target}.`
    );
    console.log(
      `[RTO] backup ${seconds(backedUp - started)} s · restore ${seconds(restored - backedUp)} s · ` +
        `total ${seconds(restored - started)} s (target < 900 s) · backup size ${statSync(file).size} bytes`
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
    await connection.end();
  }
}

if (!process.argv.includes('--rehearse') && !fromFile) {
  console.error(
    'usage: bun scripts/restoreDbBackup.ts --rehearse | --from <backup.sql.gz.enc> [--expect-tables <n>]'
  );
  process.exit(2);
}
try {
  await (fromFile ? restoreFrom(fromFile) : rehearse());
} catch (error: unknown) {
  console.error(
    `[FAIL] ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
}
