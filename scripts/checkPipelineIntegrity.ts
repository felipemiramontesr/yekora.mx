/**
 * A08 · Pipeline integrity (FC 001).
 *   a) deploy.yml is the only CI workflow: sonar.yml and l-verify.yml must not exist.
 *   b) Critical actions in deploy.yml (checkout, setup-bun, sonarqube, trufflehog) are pinned by full SHA.
 *   c) bun.lock exists and matches package.json (`bun install --frozen-lockfile --dry-run`).
 *   d) FC 008 · R1 / T1.2: db-migrations.yml is triggered by workflow_dispatch only, runs in
 *      production-db, checks the actor and pins every action (scripts/lib/workflowGuards.ts).
 *   e) FC 008 · R1: no workflow other than db-migrations.yml mentions self-hosted.
 *   f) FC 009 · K-13: the apiv1 smoke test and the catalog read of deploy.yml are always on.
 *      FC 025: one job per layer (Frontend without apps/api, Backend, Database on MariaDB
 *      11.8.9), none switched off, and global-certification waits for all of them.
 *   g) FC 016 · K-32: dependency-audit-cron.yml runs the audit gate daily on ubuntu-24.04 with
 *      pinned actions, and dependabot.yml keeps Archon's policy (bun, no majors, two groups).
 *   h) FC 026: one job per piece of work with its commands, eight E2E shards, no wait-on (in
 *      deploy.yml or package.json), and service workers blocked in every E2E suite but the PWA's.
 *   i) Every workflow and dependabot.yml is valid YAML with unique keys; GitHub refuses the
 *      whole file otherwise, and the text rules above cannot see it.
 *   j) FC 037: dependabot-automerge.yml auto-merges Dependabot patches only, behind the Global
 *      Certification check, with SECURITY_AUTOFIX_TOKEN; minor and major wait for Ω.
 *   k) FC 039: no E2E suite waits for networkidle, and every wait for the released API demands
 *      this commit with status ok and its database connected.
 *   l) FC 043 T2.4: the catalog console of the account area is a lazy chunk (next/dynamic with
 *      ssr: false), never imported statically, so buyers do not download it with /cuenta/.
 * CLI: `bun scripts/checkPipelineIntegrity.ts` — exit 0 = intact · exit 1 = tampered or unpinned.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  auditCronViolations,
  dependabotAutomergeViolations,
  dependabotViolations,
  dependencyViolations,
  deployWorkflowViolations,
  lazyAdminChunkViolations,
  mentionsSelfHosted,
  migrationsWorkflowViolations,
  networkIdleViolations,
  serviceWorkerViolations,
  yamlSyntaxViolations,
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
for (const path of [
  ...readdirSync(workflowsDir)
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => join('.github', 'workflows', name)),
  join('.github', 'dependabot.yml'),
]) {
  if (!existsSync(join(root, path))) continue;
  for (const violation of yamlSyntaxViolations(
    readFileSync(join(root, path), 'utf8')
  )) {
    failures.push(`i) ${path}: ${violation}`);
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
const automergePath = join(workflowsDir, 'dependabot-automerge.yml');
if (existsSync(automergePath)) {
  for (const violation of dependabotAutomergeViolations(
    readFileSync(automergePath, 'utf8')
  )) {
    failures.push(`j) dependabot-automerge.yml: ${violation}`);
  }
} else {
  failures.push('j) .github/workflows/dependabot-automerge.yml is missing');
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

for (const violation of dependencyViolations(
  readFileSync(join(root, 'package.json'), 'utf8')
)) {
  failures.push(`h) ${violation}`);
}

/** Every .ts/.tsx file under e2e/, by repository path. */
function e2eFiles(dir: string): [string, string][] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap(
    (entry): [string, string][] => {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return e2eFiles(path);
      return /\.tsx?$/.test(entry.name)
        ? [[path, readFileSync(join(root, path), 'utf8')]]
        : [];
    }
  );
}
const playwrightFiles = new Map([
  ...e2eFiles('e2e'),
  ...['playwright.local.config.ts', 'playwright.stack.config.ts'].map(
    (path): [string, string] => [path, readFileSync(join(root, path), 'utf8')]
  ),
]);
for (const violation of serviceWorkerViolations(playwrightFiles)) {
  failures.push(`h) ${violation}`);
}
for (const violation of networkIdleViolations(playwrightFiles)) {
  failures.push(`k) ${violation}`);
}

const accountApp = 'components/account/AccountApp.tsx';
for (const violation of lazyAdminChunkViolations(
  accountApp,
  readFileSync(join(root, accountApp), 'utf8'),
  './catalog/CatalogConsole'
)) {
  failures.push(`l) ${violation}`);
}

if (failures.length > 0) {
  console.error('[FAIL] A08 pipeline integrity:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(
  '[OK] A08 pipeline integrity: valid YAML with unique keys, no legacy workflow, pinned actions, one CI job per layer, eight E2E shards, no wait-on, service workers blocked but in the PWA suite, lockfile in sync, migrations workflow manual-only and the only one on self-hosted, daily dependency audit, Dependabot policy and patch-only auto-merge in place, E2E without networkidle, API waits on a healthy database, catalog console loaded on demand.'
);
