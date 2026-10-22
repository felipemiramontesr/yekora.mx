/**
 * Migration rules shared by scripts/migrateDb.ts and its tests (FC 008, DB_LAW).
 *
 * Truth table T1.3 · MigrationSuccess ⟺ F ∧ R ∧ T:
 * - F: the file exists and follows the canonical name;
 * - R: its SHA-256 matches the registry entry, if any (an applied file never changes);
 * - T: the DDL runs (apply) or is skipped cleanly (already applied).
 * Pure functions: the database access stays in the CLI.
 *
 * @module
 */
import { createHash } from 'node:crypto';

/**
 * Canonical migration name, the same scheme Archon enforces from its migration 180:
 * `NNN_V<version>_FC<nnn>-F<n>_<YYYYMMDD>_<description>.sql`.
 */
export const MIGRATION_NAME =
  /^\d{3}_V\d+\.\d+\.\d+_FC\d{3}-F\d+_\d{8}_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;

/** What the migrator does with one file, given the registry. */
export type MigrationDecision = 'apply' | 'skip' | 'tampered';

/**
 * Migrations to run, in order: canonical names only. Rollbacks (`*_down.sql`) and
 * `seed_dev.sql` never match, so they are never applied by a normal run.
 *
 * @param fileNames - Every file name found in the migrations folder.
 * @returns Canonical migration file names, sorted by their numeric prefix.
 */
export function pendingOrder(fileNames: readonly string[]): string[] {
  return fileNames
    .filter((name) => MIGRATION_NAME.test(name))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * SHA-256 of a migration, ignoring carriage returns: the same file checked out on Windows
 * (CRLF) and Linux (LF) must hash the same, as in Archon's registry.
 *
 * @param content - The SQL text.
 * @returns Lowercase hex digest.
 */
export function migrationChecksum(content: string): string {
  return createHash('sha256')
    .update(content.replaceAll('\r', ''))
    .digest('hex');
}

/**
 * Decides one migration against the registry (T1.3 · R).
 *
 * @param checksum - Digest of the file on disk.
 * @param registered - Digest stored when it was applied, or undefined if never applied.
 * @returns `apply` when new, `skip` when already applied unchanged, `tampered` when the file
 *   changed after being applied (the run must abort).
 */
export function decide(
  checksum: string,
  registered: string | undefined
): MigrationDecision {
  if (registered === undefined) return 'apply';
  return registered === checksum ? 'skip' : 'tampered';
}

/**
 * The migrations one run applies (Archon model: one named migration per production run).
 *
 * Without a target, every pending migration in order (local development). With a target, only
 * that file, and only when every earlier migration is already applied, so the order of the
 * folder is always the order of the database. A target already applied is a safe no-op.
 *
 * @param plan - Every canonical migration with its decision, in order (tampering already ruled out).
 * @param target - File name chosen for this run, or undefined for all pending.
 * @returns The steps to apply, in order; empty when there is nothing to do.
 * @throws When the target is not a migration of the folder, or an earlier one is still pending.
 */
export function stepsToApply<
  Step extends { file: string; decision: MigrationDecision },
>(plan: readonly Step[], target?: string): Step[] {
  if (target === undefined) {
    return plan.filter((step) => step.decision === 'apply');
  }
  const index = plan.findIndex((step) => step.file === target);
  if (index === -1) {
    throw new Error(`${target} is not a canonical migration in migrations/`);
  }
  const earlier = plan
    .slice(0, index)
    .filter((step) => step.decision === 'apply');
  if (earlier.length > 0) {
    throw new Error(
      `apply ${earlier.map((step) => step.file).join(', ')} first: migrations run in order`
    );
  }
  return plan[index].decision === 'apply' ? [plan[index]] : [];
}

/**
 * Whether a database host is the local machine. Development data (`seed_dev.sql`) and
 * rollbacks only run there: fictitious products must never reach production.
 *
 * @param host - The configured DB host.
 */
export function isLocalHost(host: string): boolean {
  return ['localhost', '127.0.0.1', '::1'].includes(host.trim().toLowerCase());
}

/**
 * Whether a database name belongs to Yekora: `yekora_…` locally, or Hostinger's account-prefixed
 * `u<digits>_yekora[_…]` in production (hPanel always prepends the account id). The local MariaDB
 * and the Hostinger account are shared with other projects (Archon among them), so every script
 * refuses to read, write, drop or create any database outside these two shapes.
 *
 * @param name - Database name from the environment.
 */
export function isYekoraDatabase(name: string): boolean {
  return /^(?:u\d+_yekora(?:_[a-z0-9_]+)?|yekora_[a-z0-9_]+)$/.test(name);
}

/**
 * The verification counters of a migration (FC 015 §4): `NNN_verify.sql` next to it, like
 * `NNN_down.sql`. Its name never matches MIGRATION_NAME, so it is never applied as a migration.
 *
 * @param migration - Canonical migration file name.
 * @returns e.g. `003_verify.sql` for `003_V0.8.0_…sql`.
 */
export function verifyFileFor(migration: string): string {
  return `${migration.slice(0, 3)}_verify.sql`;
}

/**
 * One line of verification counters for the log and the workflow summary: aggregates only.
 *
 * @param migration - Canonical migration file name.
 * @param counters - The single row its verify query returned.
 * @returns e.g. `[VERIFY] 001 disciplines=5 levels=4 products=3`.
 */
export function formatCounters(
  migration: string,
  counters: Readonly<Record<string, unknown>>
): string {
  const pairs = Object.entries(counters).map(
    ([name, value]) => `${name}=${String(value)}`
  );
  return `[VERIFY] ${migration.slice(0, 3)} ${pairs.join(' ')}`;
}
