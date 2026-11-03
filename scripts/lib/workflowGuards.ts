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
 * The other rules read the text, so they cannot see that a file is not valid YAML; GitHub then
 * refuses the whole workflow on every push. {@link yamlSyntaxViolations} parses each file first.
 *
 * @module
 */
import { parseDocument } from 'yaml';

/**
 * Parse errors of a workflow or Dependabot file, duplicate keys included: GitHub refuses such a
 * file outright (run 41374309856: a second `timeout-minutes` left db-migrations.yml unusable).
 *
 * @param text - File text.
 * @returns One message per parse error, with its line; empty when the YAML is valid.
 */
export function yamlSyntaxViolations(text: string): string[] {
  return parseDocument(text, { uniqueKeys: true }).errors.map(
    (error) => `invalid YAML: ${error.message.split('\n')[0]}`
  );
}

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
  violations.push(
    ...stageOneViolations(workflow),
    ...concurrencyViolations(workflow),
    ...e2eMatrixViolations(workflow),
    ...jobTimeoutViolations(workflow, DEPLOY_TIMEOUTS),
    ...boundedNetworkViolations(workflow)
  );
  return violations;
}

/**
 * FC 026 Enmienda 8: up to 60 s for Apache, then one last curl outside the loop, which fails the
 * step if Apache never answered (a loop that ends in `sleep` would exit 0). Replaces wait-on.
 */
const APACHE_PROBE = [
  'seq 1 30',
  'sleep 2',
  'curl -fsS http://localhost:3100',
  'done; curl -fsS http://localhost:3100',
];

/**
 * The verification jobs of deploy.yml's first stage and what each must run (FC 025 T1.1–T1.2,
 * FC 026 T2 JobCommands): one job per piece of work, so a job that exists without its command
 * fails A08 instead of passing green.
 */
const STAGE_ONE_JOBS: Readonly<Record<string, readonly string[]>> = {
  'static-analysis': [
    'bun run lint',
    'bun run typecheck',
    'tsc-result.json',
    'bun run check:tsdoc',
    // FC 027 T2.4/T2.5: static export, SPA fallbacks and mail only through the outbox.
    'bun scripts/checkPlatformGuards.ts',
  ],
  'dependency-audit': ['bun scripts/dependencyAuditGate.ts'],
  'frontend-validation': ['vitest run --config vitest.frontend.config.ts'],
  'tooling-validation': ['vitest run --config vitest.tooling.config.ts'],
  'backend-validation': [
    'bun run --cwd apps/api build',
    // FC 027 T2.2/T2.6 (Q03): OpenAPI in sync, no breaking change, every route guarded.
    'bun scripts/checkApiContract.ts',
    'vitest run --config vitest.backend.config.ts --coverage',
  ],
  'database-validation': [
    'image: mariadb:11.8.9',
    'bun scripts/migrateDb.ts',
    'dbParityCheck.ts --expect',
    'vitest run --config vitest.db.config.ts',
  ],
  'security-scan': [
    'trufflesecurity/trufflehog@',
    'extra_args: --only-verified',
  ],
  'sonar-scan': [
    'bun run test:coverage',
    'node tools/verify-sonar-spotless.mjs',
  ],
  // FC 026 Enmienda 10: the production site, built at t = 0 for the deploy.
  'site-build': [
    'CATALOG_API_URL: https://apiv1.yekora.mx',
    'bun run build',
    'name: prod-static-out',
  ],
  'e2e-build': [
    'playwright.local.config.ts',
    'smoke.spec.ts',
    'CATALOG_FIXTURE: e2e/fixtures/catalog.json',
    'bun run build',
    'name: e2e-static-out',
  ],
  'e2e-validation': [
    'name: e2e-static-out',
    'actions/cache@',
    '~/.cache/ms-playwright',
    '.playwright-version',
    // FC 026 Enmienda 10: WebKit's Linux packages kept between runs (restore, then backup).
    '/home/runner/apt-cache',
    'webkit-apt',
    'sudo cp -n /home/runner/apt-cache/*.deb /var/cache/apt/archives/',
    'sudo cp -n /var/cache/apt/archives/*.deb /home/runner/apt-cache/',
    'sudo chown -R runner:docker /home/runner/apt-cache',
    'httpd:2.4',
    ...APACHE_PROBE,
    'playwright test --config=playwright.local.config.ts --project=${{ matrix.project }} --shard=${{ matrix.shard }}',
  ],
  'e2e-stack-validation': [
    'image: mariadb:11.8.9',
    'bun scripts/migrateDb.ts',
    'bun scripts/seedE2eStack.ts',
    'actions/cache@',
    '~/.cache/ms-playwright',
    '.playwright-version',
    'http://127.0.0.1:3001/health',
    '.status == "ok" and .db == "connected"',
    'CATALOG_API_URL: http://127.0.0.1:3001',
    'httpd:2.4',
    ...APACHE_PROBE,
    'playwright test --config=playwright.stack.config.ts',
  ],
};

/** The eight E2E shards (FC 026 Enmienda 10): WebKit, the slowest engine, in four. */
const E2E_SHARDS = [
  "{ project: 'chromium', shard: '1/2' }",
  "{ project: 'chromium', shard: '2/2' }",
  "{ project: 'webkit', shard: '1/4' }",
  "{ project: 'webkit', shard: '2/4' }",
  "{ project: 'webkit', shard: '3/4' }",
  "{ project: 'webkit', shard: '4/4' }",
  "{ project: 'mobile-chrome', shard: '1/2' }",
  "{ project: 'mobile-chrome', shard: '2/2' }",
];

/** Jobs global-certification must wait for before any release (FC 026 T1.4). */
const CERTIFIED_JOBS = [
  'static-analysis',
  'dependency-audit',
  'frontend-validation',
  'tooling-validation',
  'backend-validation',
  'database-validation',
  'security-scan',
  'e2e-validation',
  'e2e-stack-validation',
  'sonar-scan',
];

/** What each E2E job may wait for (FC 026 T2): never the Frontend job. */
const E2E_NEEDS: Readonly<Record<string, string>> = {
  'e2e-build': '',
  'e2e-validation': 'e2e-build',
  'e2e-stack-validation': '',
};

/** One stage-one job: present, switched on, on GitHub's Ubuntu and running its commands. */
function jobViolations(
  job: string,
  block: readonly string[] | undefined,
  required: readonly string[]
): string[] {
  if (block === undefined) return [`the ${job} job is missing`];
  const violations: string[] = [];
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
  return violations;
}

/** Code of a job, without comments. */
const codeOf = (block: readonly string[]) =>
  block.map((line) => line.split('#')[0]);

/**
 * FC 025 and FC 026: one job per piece of work, each named for what it runs and holding its own
 * command; none switched off; all on GitHub's Ubuntu. Frontend runs the site only, in one job;
 * E2E never waits for it; the certification waits for every verification job.
 */
function stageOneViolations(workflow: string): string[] {
  const blocks = jobBlocks(workflow);
  const violations = Object.entries(STAGE_ONE_JOBS).flatMap(([job, required]) =>
    jobViolations(job, blocks.get(job), required)
  );
  const frontend = codeOf(blocks.get('frontend-validation') ?? []);
  if (
    frontend.some(
      (line) => line.includes('apps/api') || line.includes('scripts/')
    )
  ) {
    violations.push(
      'the frontend-validation job must test the site only (no apps/api, no scripts/)'
    );
  }
  if (frontend.some((line) => /^ {4}strategy:/.test(line))) {
    violations.push(
      'the frontend-validation job must be one job, without a matrix'
    );
  }
  for (const [job, expected] of Object.entries(E2E_NEEDS)) {
    const needs = jobNeeds(blocks.get(job) ?? []).join(', ');
    if (blocks.has(job) && needs !== expected) {
      violations.push(
        `the ${job} job must wait for ${expected || 'nothing'}, found: ${needs || 'nothing'}`
      );
    }
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
 * FC 026 T2: only a pull request cancels its own older run; a push to main is never cancelled,
 * and the release and deploy jobs keep their own non-cancelling groups.
 */
/** FC 026 Enmienda 9: the exact ceiling of every job of deploy.yml (GitHub's default is 360). */
const DEPLOY_TIMEOUTS: Readonly<Record<string, number>> = {
  'static-analysis': 15,
  'dependency-audit': 15,
  'frontend-validation': 15,
  'tooling-validation': 15,
  'backend-validation': 15,
  'database-validation': 15,
  'security-scan': 15,
  'sonar-scan': 15,
  'e2e-build': 15,
  'site-build': 15,
  'e2e-validation': 15,
  'e2e-stack-validation': 15,
  'hostinger-deployment': 15,
  'global-certification': 10,
  'api-release': 10,
};

/** The `timeout-minutes` of each job, read at job level (four spaces), not a step's. */
function jobTimeoutViolations(
  workflow: string,
  expected: Readonly<Record<string, number>>
): string[] {
  const blocks = jobBlocks(workflow);
  return Object.entries(expected).flatMap(([job, minutes]) => {
    const line = (blocks.get(job) ?? []).find((l) =>
      /^ {4}timeout-minutes:/.test(l)
    );
    const found = line?.replace(/^ {4}timeout-minutes:/, '').trim();
    return found === String(minutes)
      ? []
      : [
          `the ${job} job must have timeout-minutes: ${minutes}, found: ${found ?? 'none'}`,
        ];
  });
}

const CURL_LIMITS = ['--connect-timeout 5', '--max-time 10'];

/**
 * FC 026 Enmienda 9 (run 41248127975 hung 73 min): every curl is bounded; the API smoke waits
 * 300 s polling every 3 s and prints DNS and IPv4/IPv6 reachability on timeout; the site waits
 * for the released API (120 s) before its rsync; the browser cache follows Playwright only.
 */
function boundedNetworkViolations(workflow: string): string[] {
  const violations: string[] = [];
  const code = codeOf(workflow.split(/\r?\n/));
  const unbounded = code.filter(
    (line) =>
      /\bcurl\b/.test(line) && !CURL_LIMITS.every((flag) => line.includes(flag))
  );
  if (unbounded.length > 0) {
    violations.push(
      `every curl needs ${CURL_LIMITS.join(' ')}: ${unbounded.length} without them`
    );
  }
  const blocks = jobBlocks(workflow);
  const release = codeOf(blocks.get('api-release') ?? []);
  for (const required of [
    'SECONDS + 300',
    'sleep 3',
    // FC 039: the wait itself demands this commit with status ok and its database connected.
    HEALTHY_PROBE,
    'getent ahosts apiv1.yekora.mx',
    'curl -4',
    'curl -6',
  ]) {
    if (!release.some((line) => line.includes(required))) {
      violations.push(`the api-release smoke must run: ${required}`);
    }
  }
  violations.push(
    ...siteGateViolations(blocks.get('hostinger-deployment') ?? [])
  );
  violations.push(...browserCacheViolations(code, blocks));
  return violations;
}

/**
 * FC 039 (270_AN): the jq filter every wait for the released API uses. It yields the sha only
 * when the API is healthy and connected to MariaDB, so a restart's 503 keeps the loop waiting.
 */
const HEALTHY_PROBE = `jq -r 'select(.status == "ok" and .db == "connected") | .sha'`;

/** The deploy builds after certification and syncs only once the API serves this commit. */
function siteGateViolations(block: readonly string[]): string[] {
  const violations: string[] = [];
  const needs = jobNeeds(block).join(', ');
  if (needs !== 'global-certification, site-build') {
    violations.push(
      `the hostinger-deployment job must wait for global-certification and site-build only, found: ${needs || 'nothing'}`
    );
  }
  const code = codeOf(block);
  const rsync = code.findIndex((line) => line.includes('rsync -avz'));
  const beforeSync = code.slice(0, rsync === -1 ? 0 : rsync);
  for (const required of [
    // FC 026 Enmienda 10: the site built at t = 0 by site-build.
    'actions/download-artifact@',
    'name: prod-static-out',
    'https://apiv1.yekora.mx/health',
    '$GITHUB_SHA',
    HEALTHY_PROBE,
    'SECONDS + 120',
    'sleep 3',
    'exit 1',
    // Rebuilt against the released API only when this push changed apps/api; any doubt rebuilds.
    'BEFORE: ${{ github.event.before }}',
    '[ -n "$BEFORE" ]',
    '0000000000000000000000000000000000000000',
    'git cat-file -e "$BEFORE^{commit}"',
    'git diff --quiet "$BEFORE" "$GITHUB_SHA" -- apps/api; then',
    'else',
    'bun run build',
  ]) {
    if (!beforeSync.some((line) => line.includes(required))) {
      violations.push(`the deploy must check before its rsync: ${required}`);
    }
  }
  return violations;
}

/** One cache key for every E2E lane, derived from Playwright's version, never bun.lock. */
function browserCacheViolations(
  code: readonly string[],
  blocks: ReadonlyMap<string, string[]>
): string[] {
  const violations: string[] = [];
  // The browser caches are the ones whose path is Playwright's; WebKit's apt cache has its own.
  const keys = code.filter(
    (line, i) =>
      /^\s+key:/.test(line) &&
      code[i - 1]?.trim() === 'path: ~/.cache/ms-playwright'
  );
  const expectedKey =
    "key: ${{ runner.os }}-playwright-${{ hashFiles('.playwright-version') }}";
  if (keys.length === 0 || keys.some((line) => line.trim() !== expectedKey)) {
    violations.push(`every browser cache must use ${expectedKey}`);
  }
  for (const job of ['e2e-validation', 'e2e-stack-validation']) {
    const lines = codeOf(blocks.get(job) ?? []);
    const writes = lines.some(
      (line) =>
        line.includes("devDependencies['@playwright/test']") &&
        line.includes('> .playwright-version')
    );
    if (!writes) {
      violations.push(
        `the ${job} job must write .playwright-version from package.json`
      );
    }
  }
  return violations;
}

function e2eMatrixViolations(workflow: string): string[] {
  const violations: string[] = [];
  const browsers = codeOf(jobBlocks(workflow).get('e2e-validation') ?? []);
  const missing = E2E_SHARDS.filter(
    (shard) => !browsers.some((line) => line.trim() === `- ${shard}`)
  );
  if (missing.length > 0) {
    violations.push(`the e2e-validation matrix lacks: ${missing.join(', ')}`);
  }
  if (
    codeOf(workflow.split(/\r?\n/)).some((line) => line.includes('wait-on'))
  ) {
    violations.push(
      'wait-on is back in deploy.yml (FC 026: curl probe instead)'
    );
  }
  return violations;
}

/**
 * FC 026 Enmienda 5: wait-on is gone from the dependencies; its two high advisories of
 * 2026-10-31 (follow-redirects, joi) came only through it.
 *
 * @param packageJson - Text of package.json.
 * @returns Human-readable violations; empty when conformant.
 */
export function dependencyViolations(packageJson: string): string[] {
  const { dependencies = {}, devDependencies = {} } = JSON.parse(
    packageJson
  ) as Record<string, Record<string, string> | undefined>;
  return 'wait-on' in { ...dependencies, ...devDependencies }
    ? ['wait-on is back in package.json (FC 026)']
    : [];
}

/**
 * FC 039 (270_AN): no E2E suite waits for `networkidle`. It needs 500 ms with no request, which
 * WebKit sometimes never reports (run 41542562137); a suite waits for what the page shows.
 * Comment lines are skipped, so the reason can be written down where the wait was replaced.
 *
 * @param files - Path → text of every file under e2e/ and of the two Playwright configs.
 * @returns One message per file that still waits for an idle network.
 */
export function networkIdleViolations(
  files: ReadonlyMap<string, string>
): string[] {
  const isComment = (line: string) => /^\s*(?:\/\/|\/\*|\*)/.test(line);
  return [...files]
    .filter(([, text]) =>
      text
        .split(/\r?\n/)
        .some((line) => !isComment(line) && line.includes('networkidle'))
    )
    .map(([path]) => `${path} waits for networkidle (wait for page content)`);
}

/**
 * FC 026 T2: both Playwright configs block service workers, and only e2e/pwa.spec.ts lets them
 * run. In WebKit a service worker fetches the API past page.route, so any other suite that
 * allowed it could reach production.
 *
 * @param files - Path → text of every file under e2e/ and of the two Playwright configs.
 * @returns Human-readable violations; empty when conformant.
 */
export function serviceWorkerViolations(
  files: ReadonlyMap<string, string>
): string[] {
  const violations: string[] = [];
  for (const config of [
    'playwright.local.config.ts',
    'playwright.stack.config.ts',
  ]) {
    if (!files.get(config)?.includes("serviceWorkers: 'block'")) {
      violations.push(`${config} must block service workers`);
    }
  }
  for (const [path, text] of files) {
    const allows = codeOf(text.split(/\r?\n/)).some((line) =>
      line.includes("serviceWorkers: 'allow'")
    );
    if (allows && path !== 'e2e/pwa.spec.ts') {
      violations.push(`${path} must not allow service workers`);
    }
  }
  if (!files.get('e2e/pwa.spec.ts')?.includes("serviceWorkers: 'allow'")) {
    violations.push('e2e/pwa.spec.ts must allow the service worker it tests');
  }
  return violations;
}

function concurrencyViolations(workflow: string): string[] {
  const violations: string[] = [];
  const lines = workflow.split(/\r?\n/);
  const top = lines.indexOf('concurrency:');
  const cancel = top === -1 ? undefined : lines[top + 2];
  if (
    cancel !==
    "  cancel-in-progress: ${{ github.event_name == 'pull_request' }}"
  ) {
    violations.push(
      'the workflow must cancel older runs of a pull request only (concurrency)'
    );
  }
  const blocks = jobBlocks(workflow);
  for (const job of ['api-release', 'hostinger-deployment']) {
    const block = blocks.get(job) ?? [];
    if (!block.includes('      cancel-in-progress: false')) {
      violations.push(`the ${job} job must never be cancelled`);
    }
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
    ...parityViolations(lines, workflow),
    // FC 026 Enmienda 9: an authorization never waits long; a migration with its backup may.
    ...jobTimeoutViolations(workflow, { authorize: 5, migrate: 20 })
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

/** The pinned release of dependabot/fetch-metadata (v3.1.0) that FC 037 reviewed. */
const FETCH_METADATA =
  'dependabot/fetch-metadata@25dd0e34f4fe68f24cc83900b1fe3fe149efef98';

/**
 * Every violation of the Dependabot auto-merge workflow (FC 037, K-52, Ω's option a, A08): only
 * Dependabot's own PRs, only patches, only through GitHub auto-merge behind the Global
 * Certification check, enabled with SECURITY_AUTOFIX_TOKEN (so the merge deploys), and the
 * repository token never writes code.
 *
 * @param workflow - Text of dependabot-automerge.yml.
 * @returns Human-readable violations; empty when conformant.
 */
export function dependabotAutomergeViolations(workflow: string): string[] {
  const violations: string[] = [];
  const triggers = workflowTriggers(workflow);
  if (triggers.join() !== 'pull_request') {
    violations.push(
      `the only trigger must be pull_request, found: ${triggers.join(', ') || 'none'}`
    );
  }
  const required: readonly [string, string][] = [
    [
      "github.event.pull_request.user.login == 'dependabot[bot]' && github.actor == 'dependabot[bot]'",
      'it must act only on PRs opened and pushed by dependabot[bot]',
    ],
    [`uses: ${FETCH_METADATA}`, `it must use ${FETCH_METADATA}`],
    [
      "if: steps.metadata.outputs.update-type == 'version-update:semver-patch'",
      'auto-merge must be enabled for patches only',
    ],
    [
      'GH_TOKEN: ${{ secrets.SECURITY_AUTOFIX_TOKEN }}',
      'auto-merge must be enabled with SECURITY_AUTOFIX_TOKEN (the repository token does not deploy)',
    ],
    [
      '🔱 Yekora Global Certification',
      'auto-merge must be gated on the Global Certification check',
    ],
    [
      'gh pr merge --auto --squash',
      'a patch must merge through GitHub auto-merge',
    ],
    ['requires-omega-approval', 'a minor or major update must be held for Ω'],
  ];
  for (const [needle, message] of required) {
    if (!workflow.includes(needle)) violations.push(message);
  }
  if (/gh pr merge(?![^\n]*--auto)/.test(workflow)) {
    violations.push(
      'a PR may only be merged with --auto (behind the required check)'
    );
  }
  const lines = workflow.split(/\r?\n/).map((line) => line.trim());
  if (lines.includes('contents: write')) {
    violations.push('the repository token must not get contents write');
  }
  const secrets = [...workflow.matchAll(/secrets\.\w+/g)].map((m) => m[0]);
  if (secrets.some((secret) => secret !== AUTOFIX_SECRET)) {
    violations.push(`only ${AUTOFIX_SECRET} may reach the auto-merge workflow`);
  }
  if (
    mentionsSelfHosted(workflow) ||
    lines.some((l) => l.startsWith('runs-on:') && l !== 'runs-on: ubuntu-24.04')
  ) {
    violations.push('every job must run on ubuntu-24.04');
  }
  for (const uses of unpinnedActions(workflow)) {
    violations.push(`${uses} is not pinned by full commit SHA`);
  }
  violations.push(...jobTimeoutViolations(workflow, { automerge: 5 }));
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
  // A whole line: `if: failure() && …` of the autofix job must not count as the issue step's.
  const lines = workflow.split(/\r?\n/).map((line) => line.trim());
  if (!lines.includes('if: failure()')) {
    violations.push(
      'the security Issue must be opened only when the audit fails'
    );
  }
  violations.push(...autoFixViolations(workflow));
  violations.push(...tokenWatchViolations(workflow));
  violations.push(
    ...jobTimeoutViolations(workflow, {
      audit: 15,
      autofix: 15,
      'token-expiration-check': 5,
    })
  );
  return violations;
}

/**
 * FC 038 T2.0: the expiry watch of SECURITY_AUTOFIX_TOKEN is a job of its own that runs on every
 * daily run (`if: always()`, no `needs`), so an audit at zero cannot skip it.
 */
function tokenWatchViolations(workflow: string): string[] {
  const block = jobBlocks(workflow).get('token-expiration-check');
  if (block === undefined)
    return ['the token-expiration-check job is missing (FC 038)'];
  const lines = block.map((line) => line.trim());
  const violations: string[] = [];
  if (!lines.includes('run: bun scripts/checkTokenExpiration.ts'))
    violations.push(
      'token-expiration-check must run scripts/checkTokenExpiration.ts'
    );
  if (!lines.includes('if: always()'))
    violations.push(
      'token-expiration-check must run on every daily run (if: always())'
    );
  if (jobNeeds(block).length > 0)
    violations.push('token-expiration-check must not wait for another job');
  if (!lines.includes('TOKEN_TO_CHECK: ${{ secrets.SECURITY_AUTOFIX_TOKEN }}'))
    violations.push(
      'token-expiration-check must inspect SECURITY_AUTOFIX_TOKEN itself'
    );
  return violations;
}

/** The only secret the audit workflow may read (FC 036: pushes the fix PR, nothing else). */
const AUTOFIX_SECRET = 'secrets.SECURITY_AUTOFIX_TOKEN';

/**
 * FC 036 T2.2 (Ω's option a): the issue closes only on a clean audit; the auto-fix applies
 * patches only, through a PR whose auto-merge is gated on the Global Certification check; the
 * repository token never writes code, and no other secret reaches the workflow.
 */
function autoFixViolations(workflow: string): string[] {
  const violations: string[] = [];
  const required: readonly [string, string][] = [
    [
      'if: success()',
      'the issue must close only when the audit is back to zero',
    ],
    ['gh issue close', 'a clean audit must close the security issue'],
    [
      'run: bun scripts/securityAutoFix.ts',
      'the autofix job must run scripts/securityAutoFix.ts',
    ],
    [
      "if: failure() && needs.audit.result == 'failure'",
      'the autofix job must run only after a failed audit',
    ],
    [
      '🔱 Yekora Global Certification',
      'auto-merge must be gated on the Global Certification check',
    ],
    [
      '--auto --squash',
      'patch PRs must merge through GitHub auto-merge, never directly',
    ],
  ];
  for (const [needle, message] of required) {
    if (!workflow.includes(needle)) violations.push(message);
  }
  // In the autofix job itself: the token watch (FC 038) has the same line and must not count.
  const autofix = (jobBlocks(workflow).get('autofix') ?? []).map((l) =>
    l.trim()
  );
  if (!autofix.includes('persist-credentials: false')) {
    violations.push('the autofix checkout must not keep the repository token');
  }
  const writes = workflow
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => ['contents: write', 'pull-requests: write'].includes(line));
  if (writes) {
    violations.push(
      'the repository token must not get contents or pull-requests write'
    );
  }
  const secrets = [...workflow.matchAll(/secrets\.\w+/g)].map((m) => m[0]);
  if (secrets.some((secret) => secret !== AUTOFIX_SECRET)) {
    violations.push(`only ${AUTOFIX_SECRET} may reach the audit workflow`);
  }
  if (/gh pr merge(?![^\n]*--auto)/.test(workflow)) {
    violations.push(
      'a PR may only be merged with --auto (behind the required check)'
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
