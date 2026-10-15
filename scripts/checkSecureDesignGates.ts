/**
 * A04 · Secure design gates (FC 001).
 * Checks, only over committed files, that the controls guarding every change exist:
 *   a) .husky/pre-commit runs lint-staged and vitest with coverage.
 *   b) package.json declares the lint, typecheck and test:coverage scripts.
 *   c) .github/workflows/deploy.yml exists with the validation, security and certification jobs.
 * CLI: `bun scripts/checkSecureDesignGates.ts` — exit 0 = all present · exit 1 = something missing.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures: string[] = [];

function read(relativePath: string): string | null {
  const fullPath = join(root, relativePath);
  return existsSync(fullPath) ? readFileSync(fullPath, 'utf8') : null;
}

const preCommit = read('.husky/pre-commit');
if (preCommit === null) {
  failures.push('a) .husky/pre-commit is missing');
} else {
  if (!preCommit.includes('lint-staged'))
    failures.push('a) pre-commit does not run lint-staged');
  if (!/vitest\b.*--coverage/.test(preCommit)) {
    failures.push('a) pre-commit does not run vitest --coverage');
  }
}

const packageJson = read('package.json');
const scripts: Record<string, unknown> =
  packageJson === null ? {} : (JSON.parse(packageJson).scripts ?? {});
for (const name of ['lint', 'typecheck', 'test:coverage']) {
  if (typeof scripts[name] !== 'string')
    failures.push(`b) package.json lacks the "${name}" script`);
}

const workflow = read('.github/workflows/deploy.yml');
if (workflow === null) {
  failures.push('c) .github/workflows/deploy.yml is missing');
} else {
  for (const job of [
    'frontend-validation',
    'security-scan',
    'global-certification',
  ]) {
    if (!new RegExp(`^  ${job}:`, 'm').test(workflow)) {
      failures.push(`c) deploy.yml has no "${job}" job`);
    }
  }
}

if (failures.length > 0) {
  console.error('[FAIL] A04 secure design gates:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(
  '[OK] A04 secure design gates present (pre-commit, package scripts, deploy.yml).'
);
