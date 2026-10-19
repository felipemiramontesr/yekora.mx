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
