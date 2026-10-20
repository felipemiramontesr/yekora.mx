/**
 * CLI of the authenticated backup format (FC 010 · YekoraALE). The logic and its tests live in
 * scripts/lib/backupCrypto.ts; this file only wires files, stdin and the exit code.
 *
 * The key is read from an environment variable, never from an argument (it would show in the
 * process list and the job log): `DB_BACKUP_ENCRYPTION_KEY` by default, or the one named by
 * `--key-env` (e.g. RESTORE_BACKUP_KEY for Ω's local drill).
 *
 * CLI:
 *   bun scripts/backupCrypto.ts encrypt --out <file.sql.gz.enc>          (plaintext on stdin)
 *   bun scripts/backupCrypto.ts decrypt --in <file.sql.gz.enc> --out <file.sql.gz>
 *   bun scripts/backupCrypto.ts decrypt --in <file.sql.gz.enc> --verify
 * Exit 0 = done (and authenticated) · exit 1 = failure, reason printed · exit 2 = usage.
 *
 * @module
 */
import { decryptToFile, encryptToFile, verifyBackup } from './lib/backupCrypto';

/** Value following a flag, or undefined when the flag is absent. */
function flagValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

const [command] = process.argv.slice(2);
const input = flagValue('--in');
const output = flagValue('--out');
const keyEnv = flagValue('--key-env') ?? 'DB_BACKUP_ENCRYPTION_KEY';
const verify = process.argv.includes('--verify');

/** The requested operation, or null when the arguments do not form one. */
function operation(secret: string): Promise<void> | null {
  if (command === 'encrypt' && output) {
    return encryptToFile(process.stdin, output, secret);
  }
  if (command === 'decrypt' && input && verify) {
    return verifyBackup(input, secret);
  }
  if (command === 'decrypt' && input && output) {
    return decryptToFile(input, output, secret);
  }
  return null;
}

const secret = process.env[keyEnv] ?? '';
const run = operation(secret);
if (run === null) {
  console.error(
    'usage: bun scripts/backupCrypto.ts encrypt --out <file> | decrypt --in <file> (--out <file> | --verify) [--key-env NAME]'
  );
  process.exit(2);
}
try {
  await run;
  const done =
    command === 'encrypt'
      ? `${output} written as YEKORA_GCM_V1`
      : `${input} authenticated`;
  console.log(`[OK] ${command}: ${done}`);
} catch (error: unknown) {
  // Only the reason: never the key, never its variable's value.
  const reason = error instanceof Error ? error.message : 'unknown error';
  console.error(`[FAIL] ${reason} (key from ${keyEnv})`);
  process.exit(1);
}
