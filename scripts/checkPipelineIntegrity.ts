/**
 * A08 · Pipeline integrity (FC 001).
 *   a) deploy.yml is the only CI workflow: sonar.yml and l-verify.yml must not exist.
 *   b) Critical actions in deploy.yml (checkout, setup-bun, sonarqube, trufflehog) are pinned by full SHA.
 *   c) bun.lock exists and matches package.json (`bun install --frozen-lockfile --dry-run`).
 *   d) FC 008 · R1 / T1.2: db-migrations.yml is triggered by workflow_dispatch only, runs in
 *      production-db, checks the actor and pins every action (scripts/lib/workflowGuards.ts).
 *   e) FC 008 · R1: no workflow other than db-migrations.yml mentions self-hosted.
 *   f) FC 009 · K-13: the apiv1 smoke test and the catalog read of deploy.yml are always on.
 *   g) FC 016 · K-32: dependency-audit-cron.yml runs the audit gate daily on ubuntu-24.04 with
 *      pinned actions, and dependabot.yml keeps Archon's policy (bun, no majors, two groups).
 * CLI: `bun scripts/checkPipelineIntegrity.ts` — exit 0 = intact · exit 1 = tampered or unpinned.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  auditCronViolations,
  dependabotViolations,
  deployWorkflowViolations,
  mentionsSelfHosted,
  migrationsWorkflowViolations,
} from './lib/workflowGuards';

/** GitHub login of GrayMan (Ω), the only actor allowed to migrate production. */
const OWNER = 'felipemiramontesr';
const MIGRATIONS_WORKFLOW = 'db-migrations.yml';

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
  for (const violation of deployWorkflowViolations(
    readFileSync(deployPath, 'utf8')
  )) {
    failures.push(`f) deploy.yml: ${violation}`);
  }
} else {
  failures.push('b) .github/workflows/deploy.yml is missing');
}

const migrationsPath = join(workflowsDir, MIGRATIONS_WORKFLOW);
if (existsSync(migrationsPath)) {
  for (const violation of migrationsWorkflowViolations(
    readFileSync(migrationsPath, 'utf8'),
    OWNER
  )) {
    failures.push(`d) ${MIGRATIONS_WORKFLOW}: ${violation}`);
  }
}
for (const name of readdirSync(workflowsDir)) {
  if (name === MIGRATIONS_WORKFLOW || !/\.ya?ml$/.test(name)) continue;
  if (mentionsSelfHosted(readFileSync(join(workflowsDir, name), 'utf8'))) {
    failures.push(
      `e) ${name} targets a self-hosted runner (only ${MIGRATIONS_WORKFLOW} may)`
    );
  }
}

const auditCronPath = join(workflowsDir, 'dependency-audit-cron.yml');
if (existsSync(auditCronPath)) {
  for (const violation of auditCronViolations(
    readFileSync(auditCronPath, 'utf8')
  )) {
    failures.push(`g) dependency-audit-cron.yml: ${violation}`);
  }
} else {
  failures.push('g) .github/workflows/dependency-audit-cron.yml is missing');
}
const dependabotPath = join(root, '.github', 'dependabot.yml');
if (existsSync(dependabotPath)) {
  for (const violation of dependabotViolations(
    readFileSync(dependabotPath, 'utf8')
  )) {
    failures.push(`g) dependabot.yml: ${violation}`);
  }
} else {
  failures.push('g) .github/dependabot.yml is missing');
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
  '[OK] A08 pipeline integrity: no legacy workflow, pinned actions, lockfile in sync, migrations workflow manual-only and the only one on self-hosted, daily dependency audit and Dependabot policy in place.'
);
