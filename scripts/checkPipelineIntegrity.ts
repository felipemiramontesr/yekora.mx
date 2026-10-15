/**
 * A08 · Pipeline integrity (FC 001).
 *   a) deploy.yml is the only CI workflow: sonar.yml and l-verify.yml must not exist.
 *   b) Critical actions in deploy.yml (checkout, setup-bun, sonarqube, trufflehog) are pinned by full SHA.
 *   c) bun.lock exists and matches package.json (`bun install --frozen-lockfile --dry-run`).
 * CLI: `bun scripts/checkPipelineIntegrity.ts` — exit 0 = intact · exit 1 = tampered or unpinned.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const workflowsDir = join(root, '.github', 'workflows');
const failures: string[] = [];

for (const legacy of ['sonar.yml', 'l-verify.yml']) {
  if (existsSync(join(workflowsDir, legacy))) {
    failures.push(
      `a) legacy workflow .github/workflows/${legacy} still exists`
    );
  }
}

const deployPath = join(workflowsDir, 'deploy.yml');
if (existsSync(deployPath)) {
  const usesLines = readFileSync(deployPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => /^(?:- )?uses: *(\S+)/.exec(line.trim())?.[1])
    .filter((uses): uses is string => uses !== undefined);
  const critical = [
    'actions/checkout',
    'oven-sh/setup-bun',
    'SonarSource/',
    'trufflesecurity/trufflehog',
  ];
  for (const uses of usesLines) {
    if (!critical.some((prefix) => uses.startsWith(prefix))) continue;
    if (!/@[0-9a-f]{40}$/.test(uses))
      failures.push(`b) ${uses} is not pinned by full commit SHA`);
  }
  for (const prefix of critical) {
    if (!usesLines.some((uses) => uses.startsWith(prefix))) {
      failures.push(`b) deploy.yml does not use ${prefix}`);
    }
  }
} else {
  failures.push('b) .github/workflows/deploy.yml is missing');
}

if (existsSync(join(root, 'bun.lock'))) {
  // process.execPath is the bun binary running this script: no lookup through PATH.
  const frozen = spawnSync(
    process.execPath,
    ['install', '--frozen-lockfile', '--dry-run'],
    {
      encoding: 'utf8',
    }
  );
  if (frozen.status !== 0)
    failures.push('c) bun.lock is out of sync with package.json');
} else {
  failures.push('c) bun.lock is missing');
}

if (failures.length > 0) {
  console.error('[FAIL] A08 pipeline integrity:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(
  '[OK] A08 pipeline integrity: single workflow, pinned actions, lockfile in sync.'
);
