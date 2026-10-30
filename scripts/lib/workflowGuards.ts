/**
 * Workflow rules of the R1 safeguard (FC 008, truth table T1.2): pure functions over workflow
 * text, applied by scripts/checkPipelineIntegrity.ts (A08).
 *
 * The migrations runner is a self-hosted machine with database access in a public repository,
 * so the rules are structural and checked on every push:
 * - db-migrations.yml is triggered by `workflow_dispatch` only, runs in `production-db` and
 *   checks the actor;
 * - every action it uses is pinned by full commit SHA;
 * - no other workflow mentions `self-hosted`, so no other path reaches that machine.
 *
 * @module
 */

/**
 * Events under the top-level `on:` key, in both YAML forms (`on: push`, `on: [a, b]` or a
 * block of keys).
 *
 * @param workflow - Workflow file text.
 * @returns Event names, in order of appearance.
 */
export function workflowTriggers(workflow: string): string[] {
  const lines = workflow.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith('on:'));
  if (start === -1) return [];
  const inline = lines[start].slice(3).trim();
  if (inline) {
    return inline
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((event) => event.trim())
      .filter(Boolean);
  }
  const events: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break; // next top-level key
    const key = /^ {2}([\w-]+):/.exec(line)?.[1];
    if (key) events.push(key);
  }
  return events;
}

/**
 * `uses:` references that are not pinned by a full 40-character commit SHA.
 *
 * @param workflow - Workflow file text.
 */
export function unpinnedActions(workflow: string): string[] {
  return workflow
    .split(/\r?\n/)
    .map((line) => /^(?:- )?uses: *(\S+)/.exec(line.trim())?.[1])
    .filter((uses): uses is string => uses !== undefined)
    .filter((uses) => !/@[0-9a-f]{40}$/.test(uses));
}

/**
 * Whether a workflow targets a self-hosted runner anywhere (comments excluded).
 *
 * @param workflow - Workflow file text.
 */
export function mentionsSelfHosted(workflow: string): boolean {
  return workflow
    .split(/\r?\n/)
    .some((line) => line.split('#')[0].includes('self-hosted'));
}

/**
 * Violations of the always-on API checks of deploy.yml (FC 009 F0 · K-13). The F5 bootstrap
 * switch `vars.API_LIVE` let the API smoke test and the catalog read be skipped without failing;
 * it is retired, and nothing may make those two steps conditional again.
 *
 * @param workflow - Text of deploy.yml.
 * @returns Human-readable violations; empty when conformant.
 */
export function deployWorkflowViolations(workflow: string): string[] {
  const violations: string[] = [];
  // Code only: a comment may tell the history of the switch.
  const code = workflow.split(/\r?\n/).map((line) => line.split('#')[0]);
  if (code.some((line) => line.includes('API_LIVE'))) {
    violations.push('the retired API_LIVE switch is back (K-13)');
  }
  const lines = workflow.split(/\r?\n/).map((line) => line.trim());
  const smoke = lines.indexOf(
    '- name: 🔥 Smoke test — apiv1.yekora.mx serves this commit'
  );
  if (smoke === -1) {
    violations.push('the apiv1.yekora.mx smoke test is missing');
  } else if (
    lines.slice(smoke + 1, smoke + 4).some((line) => line.startsWith('if:'))
  ) {
    violations.push('the apiv1.yekora.mx smoke test must not be conditional');
  }
  if (!lines.includes('CATALOG_API_URL: https://apiv1.yekora.mx')) {
    violations.push(
      'the site build must always read the catalog from apiv1.yekora.mx'
    );
  }
  violations.push(...layerViolations(workflow));
  return violations;
}

/** The three layer jobs of deploy.yml (FC 025 T1.1, T1.2) and what each must run. */
const LAYER_JOBS: Readonly<Record<string, readonly string[]>> = {
  'frontend-validation': ['vitest run --config vitest.frontend.config.ts'],
  'backend-validation': [
    'bun run --cwd apps/api build',
    'vitest run --config vitest.backend.config.ts --coverage',
  ],
  'database-validation': [
    'image: mariadb:11.8.9',
    'bun scripts/migrateDb.ts',
    'dbParityCheck.ts --expect',
    'vitest run --config vitest.db.config.ts',
  ],
};

/** Jobs global-certification must wait for before any release (FC 025 T1.3). */
const CERTIFIED_JOBS = [
  'frontend-validation',
  'backend-validation',
  'database-validation',
  'security-scan',
  'e2e-validation',
  'sonar-scan',
];

/**
 * FC 025: one job per layer, each named for what it runs. Frontend never touches apps/api, the
 * Backend and Database jobs are never switched off, all three run on GitHub's Ubuntu, and the
 * certification waits for every verification job.
 */
function layerViolations(workflow: string): string[] {
  const blocks = jobBlocks(workflow);
  const violations: string[] = [];
  for (const [job, required] of Object.entries(LAYER_JOBS)) {
    const block = blocks.get(job);
    if (block === undefined) {
      violations.push(`the ${job} job is missing`);
      continue;
    }
    if (block.some((line) => /^ {4}if:\s*false\b/.test(line))) {
      violations.push(`the ${job} job is switched off (if: false)`);
    }
    if (!block.includes('    runs-on: ubuntu-24.04')) {
      violations.push(`the ${job} job must run on ubuntu-24.04`);
    }
    for (const step of required) {
      if (!block.some((line) => line.includes(step))) {
        violations.push(`the ${job} job must run: ${step}`);
      }
    }
  }
  const frontend = blocks.get('frontend-validation') ?? [];
  if (frontend.some((line) => line.split('#')[0].includes('apps/api'))) {
    violations.push(
      'the frontend-validation job must not build or test apps/api'
    );
  }
  const waited = new Set(jobNeeds(blocks.get('global-certification') ?? []));
  const missing = CERTIFIED_JOBS.filter((job) => !waited.has(job));
  if (missing.length > 0) {
    violations.push(
      `global-certification must wait for: ${missing.join(', ')}`
    );
  }
  return violations;
}

/**
 * Every R1 violation of the migrations workflow.
 *
 * @param workflow - Text of db-migrations.yml.
 * @param owner - GitHub login of the sovereign owner the actor must match.
 * @returns Human-readable violations; empty when conformant.
 */
export function migrationsWorkflowViolations(
  workflow: string,
  owner: string
): string[] {
  const violations: string[] = [];
  const triggers = workflowTriggers(workflow);
  if (triggers.join() !== 'workflow_dispatch') {
    violations.push(
      `triggers must be workflow_dispatch only, found: ${triggers.join(', ') || 'none'}`
    );
  }
  const lines = workflow.split(/\r?\n/).map((line) => line.trim());
  if (!lines.includes('environment: production-db')) {
    violations.push('the migrate job must run in environment production-db');
  }
  // Archon's convention (Ω, 2026-10-19): every run is titled with the migration it applies.
  if (
    !lines.includes(
      'run-name: 🏛️ ${{ inputs.migration_file }} · @${{ github.actor }}'
    )
  ) {
    violations.push(
      'the run title must name the migration file (Archon convention)'
    );
  }
  if (!workflow.includes(`[ "$ACTOR" = "${owner}" ]`)) {
    violations.push(`the actor guard for ${owner} is missing`);
  }
  violations.push(
    ...runnerViolations(workflow),
    ...parityViolations(lines, workflow)
  );
  for (const uses of unpinnedActions(workflow)) {
    violations.push(`${uses} is not pinned by full commit SHA`);
  }
  return violations;
}

/** Runner each migrations job must use (FC 017 T2): only `migrate` reaches the database host. */
const MIGRATION_RUNNERS: Readonly<Record<string, string>> = {
  authorize: 'ubuntu-24.04',
  migrate: '[self-hosted, yekora-db]',
};

/**
 * The lines of every job, read from the two-space job keys under `jobs:`.
 *
 * @param workflow - Text of a workflow.
 * @returns Job id → the lines below its key, as written.
 */
function jobBlocks(workflow: string): Map<string, string[]> {
  const blocks = new Map<string, string[]>();
  let inJobs = false;
  let job: string[] | null = null;
  for (const line of workflow.split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      inJobs = line.trimEnd() === 'jobs:';
      job = null;
      continue;
    }
    if (!inJobs) continue;
    const key = /^ {2}([\w-]+):\s*$/.exec(line);
    if (key) {
      job = [];
      blocks.set(key[1], job);
      continue;
    }
    job?.push(line);
  }
  return blocks;
}

/**
 * The jobs a job waits for, whether `needs` is written on one line or spread over several (as
 * Prettier prints a long list).
 *
 * @param block - Lines of the job.
 * @returns Job ids in `needs`; empty when it has none.
 */
function jobNeeds(block: readonly string[]): string[] {
  const start = block.findIndex((line) => line.startsWith('    needs:'));
  if (start === -1) return [];
  const rest = block.slice(start + 1);
  const end = rest.findIndex((line) => !/^ {6,}\S/.test(line));
  const text = [block[start], ...rest.slice(0, end === -1 ? rest.length : end)]
    .join(' ')
    .replace(/^ {4}needs:/, '');
  return text
    .replace(/[[\]\s]/g, '')
    .split(',')
    .filter((job) => job !== '');
}

/**
 * The `runs-on` of every job.
 *
 * @param workflow - Text of a workflow.
 * @returns Job id → its `runs-on` value as written; a job without one is absent.
 */
function jobRunners(workflow: string): Map<string, string> {
  const runners = new Map<string, string>();
  for (const [job, lines] of jobBlocks(workflow)) {
    // Trimmed after matching: a lazy capture between `\s*` would backtrack (sonarjs).
    const runsOn = lines
      .map((line) => /^ {4}runs-on:(.*)$/.exec(line))
      .find((match) => match !== null);
    if (runsOn) runners.set(job, runsOn[1].trim());
  }
  return runners;
}

/**
 * FC 017 T2: `authorize` runs on GitHub's Ubuntu and `migrate` on the database host, written
 * exactly as in the file, so moving either job to another runner fails A08.
 */
function runnerViolations(workflow: string): string[] {
  const runners = jobRunners(workflow);
  return Object.entries(MIGRATION_RUNNERS)
    .filter(([job, expected]) => runners.get(job) !== expected)
    .map(
      ([job, expected]) =>
        `the ${job} job must run on ${expected}, found: ${runners.get(job) ?? 'none'}`
    );
}

/**
 * FC 015 (K-31, Archon's Rule 23): the migrations workflow publishes production's schema
 * fingerprint on every run, apply or skip, with the tested CLI, and decides its T1.2 verdict
 * with the tested pure gate.
 */
function parityViolations(
  lines: readonly string[],
  workflow: string
): string[] {
  const violations: string[] = [];
  if (!lines.includes('LINE=$(bun scripts/dbParityCheck.ts)')) {
    violations.push(
      'the schema fingerprint must come from scripts/dbParityCheck.ts'
    );
  }
  if (
    !lines.includes(
      "if: always() && steps.connect.outcome == 'success' && steps.plan.outcome == 'success' && steps.apply.outcome != 'failure'"
    )
  ) {
    violations.push('the schema fingerprint must run on apply and on skip');
  }
  if (
    !lines.includes(
      "if: steps.plan.outputs.decision == 'skip' || steps.backup.outcome == 'success'"
    )
  ) {
    violations.push(
      'an apply must wait for the backup, and a skip must still print its counters'
    );
  }
  if (!workflow.includes('| Huella de esquema PROD (Regla 23) |')) {
    violations.push('the summary must print the Rule 23 fingerprint line');
  }
  if (
    !workflow.includes(
      'import { workflowVerdict } from "./scripts/lib/dbParity.ts"'
    )
  ) {
    violations.push(
      'the T1.2 verdict must come from workflowVerdict (scripts/lib/dbParity.ts)'
    );
  }
  return violations;
}

/**
 * Every violation of the daily dependency audit (FC 016, K-32, A08). It runs the product's
 * audit gate on a public runner only, with pinned actions, on a schedule or by hand, and touches
 * the `security` Issue only when the gate fails.
 *
 * @param workflow - Text of dependency-audit-cron.yml.
 * @returns Human-readable violations; empty when conformant.
 */
export function auditCronViolations(workflow: string): string[] {
  const violations: string[] = [];
  const triggers = workflowTriggers(workflow).sort((a, b) =>
    a.localeCompare(b)
  );
  if (triggers.join() !== 'schedule,workflow_dispatch') {
    violations.push(
      `triggers must be schedule and workflow_dispatch, found: ${triggers.join(', ') || 'none'}`
    );
  }
  const runners = workflow
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('runs-on:'))
    .map((line) => line.slice('runs-on:'.length).trim());
  if (
    runners.length === 0 ||
    runners.some((runner) => runner !== 'ubuntu-24.04')
  ) {
    violations.push('every job must run on ubuntu-24.04');
  }
  if (mentionsSelfHosted(workflow)) {
    violations.push('it must never target a self-hosted runner');
  }
  for (const uses of unpinnedActions(workflow)) {
    violations.push(`${uses} is not pinned by full commit SHA`);
  }
  if (!workflow.includes('run: bun scripts/dependencyAuditGate.ts')) {
    violations.push('it must run scripts/dependencyAuditGate.ts');
  }
  if (!workflow.includes('if: failure()')) {
    violations.push(
      'the security Issue must be opened only when the audit fails'
    );
  }
  return violations;
}

/**
 * Every violation of the Dependabot policy (FC 016, Archon's model): the `bun` ecosystem, no
 * major jumps for any dependency, and the two groups.
 *
 * @param config - Text of .github/dependabot.yml.
 * @returns Human-readable violations; empty when conformant.
 */
export function dependabotViolations(config: string): string[] {
  const violations: string[] = [];
  const lines = config.split(/\r?\n/).map((line) => line.trim());
  if (!lines.includes('- package-ecosystem: bun')) {
    violations.push('the ecosystem must be bun (it updates bun.lock)');
  }
  const ignoresMajors =
    lines.includes("- dependency-name: '*'") &&
    lines.includes('- version-update:semver-major');
  if (!ignoresMajors) {
    violations.push('major updates must be ignored for every dependency');
  }
  for (const group of ['dev-dependencies:', 'production-patches:']) {
    if (!lines.includes(group)) {
      violations.push(`the group ${group.slice(0, -1)} is missing`);
    }
  }
  return violations;
}
