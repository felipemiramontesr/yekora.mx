/**
 * Schema parity CLI (FC 015 F1, K-31, Archon's Rule 23). The same script runs locally and, in
 * production, on the migrations runner, so both sides compute the fingerprint with the same
 * query (scripts/sql/schemaFingerprint.sql) and the same code.
 *
 * Connection from the environment (Bun loads .env.local): DB_HOST, DB_PORT (default 3306),
 * DB_USER, DB_PASSWORD, DB_NAME. Only information_schema is read; nothing secret is printed.
 *
 * CLI:
 *   bun scripts/dbParityCheck.ts                      print "<md5> (<n> elementos)"
 *   bun scripts/dbParityCheck.ts --expect "<huella>"  compare with production's; exit 1 on drift
 *   bun scripts/dbParityCheck.ts --sql <database>     print the query bound to that schema
 *                                                     (offline; wins over any other argument)
 *
 * @module
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import mysql from 'mysql2/promise';
import {
  parityGate,
  parseCommand,
  sqlForDatabase,
  toFingerprint,
  type Fingerprint,
} from './lib/dbParity';
import { isYekoraDatabase } from './lib/migrations';

const FINGERPRINT_SQL = join(
  process.cwd(),
  'scripts',
  'sql',
  'schemaFingerprint.sql'
);

/** Reads a required variable; fails with its name only, never its value. */
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (see .env.local)`);
  return value;
}

/** Runs the fingerprint query on the configured database. */
async function fingerprintOf(sql: string): Promise<Fingerprint> {
  const database = requiredEnv('DB_NAME');
  if (!isYekoraDatabase(database)) {
    throw new Error(`DB_NAME must be a Yekora database, refusing ${database}`);
  }
  const connection = await mysql.createConnection({
    host: requiredEnv('DB_HOST'),
    port: Number(process.env.DB_PORT ?? 3306),
    user: requiredEnv('DB_USER'),
    // Empty is valid locally (XAMPP root default); production always has a secret.
    password: process.env.DB_PASSWORD ?? '',
    database,
    multipleStatements: true,
    charset: 'utf8mb4',
  });
  try {
    // Two SETs, then the SELECT: its rows are the last result set.
    const [results] = await connection.query<mysql.RowDataPacket[][]>(sql);
    const [row] = results[results.length - 1];
    return toFingerprint({
      fingerprint: row.fingerprint,
      elements: row.elements,
    });
  } finally {
    await connection.end();
  }
}

async function main(): Promise<number> {
  const command = parseCommand(process.argv.slice(2));
  const sql = readFileSync(FINGERPRINT_SQL, 'utf8');
  if (command.mode === 'sql') {
    process.stdout.write(sqlForDatabase(sql, command.database));
    return 0;
  }
  const outcome = parityGate(
    await fingerprintOf(sql),
    command.mode === 'expect' ? command.expected : undefined
  );
  console.log(outcome.message);
  return outcome.exitCode;
}

try {
  process.exit(await main());
} catch (error: unknown) {
  console.error(
    `[FAIL] ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
}
