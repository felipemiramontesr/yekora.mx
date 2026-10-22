/**
 * Schema parity rules (FC 015 F1, K-31, Archon's Rule 23 model), shared by
 * scripts/dbParityCheck.ts and its tests. Pure functions: reading the SQL file and talking to
 * MariaDB stay in the CLI.
 *
 * Truth table T1.1 · ParityVerified ⟺ E ∧ H ∧ C:
 * - E: `--expect` was given;
 * - H: the computed MD5 equals the expected one;
 * - C: the computed element count equals the expected one (⊤ when only the MD5 was given).
 * Without E the CLI only emits the fingerprint (FINGERPRINT_EMITTED, exit 0). `--sql` sits
 * outside the gate: it prints the query offline and wins over any other argument.
 *
 * @module
 */

/** The line of schemaFingerprint.sql that binds the schema; `--sql` replaces it. */
const DB_BINDING = 'SET @db := DATABASE();';
const DB_NAME = /^\w+$/;
const MD5 = /^[0-9a-f]{32}$/;
/** `<md5>` or `<md5> (<n> elementos)`, the line the workflow summary prints. */
const EXPECTED = /^([0-9a-fA-F]{32})(?:\s+\((\d+) elementos\))?$/;

/** The schema fingerprint: MD5 of the sorted elements, and how many there are. */
export interface Fingerprint {
  readonly hash: string;
  readonly elements: number;
}

/** What `--expect` carries: the MD5, and the count when the long form was used. */
export interface Expected {
  readonly hash: string;
  readonly elements: number | null;
}

/** What the CLI was asked to do. */
export type ParityCommand =
  | { mode: 'sql'; database: string }
  | { mode: 'emit' }
  | { mode: 'expect'; expected: Expected };

/** Codes of T1.1. */
type ParityCode =
  | 'PARITY_100_MATCH'
  | 'DRIFT_COUNT_MISMATCH'
  | 'DRIFT_HASH_MISMATCH'
  | 'FINGERPRINT_EMITTED';

/** One row of T1.1: its code, the process exit code and the line to print. */
export interface ParityOutcome {
  code: ParityCode;
  exitCode: 0 | 1;
  message: string;
}

/**
 * The fingerprint as the summary prints it.
 *
 * @param fingerprint - MD5 and element count.
 * @returns e.g. `7fea8f93… (159 elementos)`.
 */
export function formatFingerprint(fingerprint: Fingerprint): string {
  return `${fingerprint.hash} (${fingerprint.elements} elementos)`;
}

/**
 * Checks the row the fingerprint query returns.
 *
 * @param row - `{ fingerprint, elements }` as MariaDB answered it.
 * @returns The fingerprint, or throws if the answer is not a lowercase MD5 and a count (an empty
 *   schema gives a NULL MD5, which is refused too).
 */
export function toFingerprint(row: {
  fingerprint: unknown;
  elements: unknown;
}): Fingerprint {
  const hash = String(row.fingerprint);
  const elements = Number(row.elements);
  if (!MD5.test(hash) || !Number.isInteger(elements) || elements <= 0) {
    throw new Error(
      `Unexpected fingerprint answer: ${hash} ${String(row.elements)}`
    );
  }
  return { hash, elements };
}

/**
 * Reads the value of `--expect`.
 *
 * @param raw - `<md5>` or `<md5> (<n> elementos)`, as copied from the summary.
 * @returns The expected MD5 (lowercase) and count, if given; throws on anything else.
 */
export function parseExpected(raw: string): Expected {
  const match = EXPECTED.exec(raw.trim());
  if (match === null) {
    throw new Error(
      `--expect needs "<md5>" or "<md5> (<n> elementos)", got "${raw}"`
    );
  }
  return {
    hash: match[1].toLowerCase(),
    elements: match[2] === undefined ? null : Number(match[2]),
  };
}

/** The value after a flag, or throws when the flag is last. */
function valueAfter(
  args: readonly string[],
  index: number,
  flag: string
): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} needs a value`);
  }
  return value;
}

/**
 * Reads the CLI arguments. `--sql` takes precedence over everything (FC 015 §2): it never
 * connects and never evaluates `--expect`.
 *
 * @param args - Arguments after the script name.
 * @returns The command to run; throws on a flag without its value or a bad database name.
 */
export function parseCommand(args: readonly string[]): ParityCommand {
  const sql = args.indexOf('--sql');
  if (sql !== -1) {
    const database = valueAfter(args, sql, '--sql');
    if (!DB_NAME.test(database)) {
      throw new Error(`Invalid database name: ${database}`);
    }
    return { mode: 'sql', database };
  }
  const expect = args.indexOf('--expect');
  if (expect === -1) return { mode: 'emit' };
  return {
    mode: 'expect',
    expected: parseExpected(valueAfter(args, expect, '--expect')),
  };
}

/**
 * The query with an explicit schema instead of `DATABASE()`, to paste into phpMyAdmin (where
 * the selected database may be another one).
 *
 * @param sql - Contents of schemaFingerprint.sql.
 * @param database - Schema name (letters, digits, underscore).
 * @returns The same query bound to that schema; throws if the binding line is missing.
 */
export function sqlForDatabase(sql: string, database: string): string {
  if (!DB_NAME.test(database))
    throw new Error(`Invalid database name: ${database}`);
  if (!sql.includes(DB_BINDING)) {
    throw new Error(
      'The fingerprint query does not bind the schema with DATABASE()'
    );
  }
  return sql.replace(DB_BINDING, `SET @db := '${database}';`);
}

/**
 * Truth table T1.1, in its order: E, then H, then C.
 *
 * @param local - Fingerprint of the connected database.
 * @param expected - Value of `--expect`, or undefined when it was not given.
 * @returns The code, the exit code and the line to print.
 */
export function parityGate(
  local: Fingerprint,
  expected: Expected | undefined
): ParityOutcome {
  if (expected === undefined) {
    return {
      code: 'FINGERPRINT_EMITTED',
      exitCode: 0,
      message: formatFingerprint(local),
    };
  }
  const wanted =
    expected.elements === null
      ? expected.hash
      : formatFingerprint({ hash: expected.hash, elements: expected.elements });
  if (local.hash !== expected.hash) {
    return {
      code: 'DRIFT_HASH_MISMATCH',
      exitCode: 1,
      message: `PARITY: DRIFT — local ${formatFingerprint(local)} ≠ expected ${wanted}`,
    };
  }
  if (expected.elements !== null && expected.elements !== local.elements) {
    return {
      code: 'DRIFT_COUNT_MISMATCH',
      exitCode: 1,
      message: `PARITY: DRIFT — same MD5, but local has ${local.elements} elements and expected ${expected.elements}`,
    };
  }
  return {
    code: 'PARITY_100_MATCH',
    exitCode: 0,
    message: `PARITY: 100% MATCH — ${formatFingerprint(local)}`,
  };
}

/** Codes of T1.2. */
type WorkflowCode =
  | 'FINGERPRINT_PUBLISHED'
  | 'BACKUP_REQUIRED_FOR_APPLY'
  | 'INVALID_MIGRATION_STATE'
  | 'DB_CONNECTION_FAILED';

/**
 * Truth table T1.2 · FingerprintPublished ⟺ M ∧ P ∧ B, in its order: M, then P, then B.
 *
 * @param connected - M: the database answered (connection and the fingerprint read).
 * @param validState - P: the plan was valid and the migration (if any) applied.
 * @param backedUp - B: the encrypted backup succeeded, or the run is a skip.
 * @returns The code the workflow summary prints.
 */
export function workflowGate(
  connected: boolean,
  validState: boolean,
  backedUp: boolean
): WorkflowCode {
  if (!connected) return 'DB_CONNECTION_FAILED';
  if (!validState) return 'INVALID_MIGRATION_STATE';
  if (!backedUp) return 'BACKUP_REQUIRED_FOR_APPLY';
  return 'FINGERPRINT_PUBLISHED';
}

/** Outcomes of the migrate job's steps, as GitHub reports them (`success`, `failure`, `skipped`, ''). */
export interface StepOutcomes {
  connect: string;
  plan: string;
  decision: string;
  backup: string;
  apply: string;
  fingerprint: string;
}

/**
 * The letters of T1.2 read from the migrate job (db-migrations.yml calls this in its summary).
 * M falls when the connection check fails or the fingerprint read fails (a fingerprint step that
 * was skipped because an earlier letter fell does not count against M); P needs a valid plan and
 * no failed apply; B is the backup on an apply, and always true on a skip.
 *
 * @param steps - Step outcomes and the plan's decision (`apply` or `skip`).
 * @returns The code of T1.2.
 */
export function workflowVerdict(steps: StepOutcomes): WorkflowCode {
  return workflowGate(
    steps.connect === 'success' && steps.fingerprint !== 'failure',
    steps.plan === 'success' && steps.apply !== 'failure',
    steps.decision === 'skip' || steps.backup === 'success'
  );
}
