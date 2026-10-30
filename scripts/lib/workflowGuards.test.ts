import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  auditCronViolations,
  dependabotViolations,
  deployWorkflowViolations,
  mentionsSelfHosted,
  migrationsWorkflowViolations,
  unpinnedActions,
  workflowTriggers,
} from './workflowGuards';

const OWNER = 'felipemiramontesr';
const SHA = 'a'.repeat(40);
const migrations = readFileSync('.github/workflows/db-migrations.yml', 'utf8');
const deploy = readFileSync('.github/workflows/deploy.yml', 'utf8');

describe('workflowTriggers', () => {
  it('reads the block form', () => {
    expect(
      workflowTriggers(
        'name: x\non:\n  push:\n    branches: [main]\n  pull_request:\njobs:\n'
      )
    ).toEqual(['push', 'pull_request']);
  });

  it('reads the inline and list forms', () => {
    expect(workflowTriggers('on: push\n')).toEqual(['push']);
    expect(workflowTriggers('on: [push, schedule]\n')).toEqual([
      'push',
      'schedule',
    ]);
  });

  it('is empty without an on: key', () => {
    expect(workflowTriggers('name: x\n')).toEqual([]);
  });
});

describe('unpinnedActions', () => {
  it('reports tags and branches, accepts full SHAs', () => {
    expect(
      unpinnedActions(
        `steps:\n  - uses: actions/checkout@v5\n  - uses: a/b@${SHA} # v1\n    uses: c/d@main\n`
      )
    ).toEqual(['actions/checkout@v5', 'c/d@main']);
  });
});

describe('mentionsSelfHosted', () => {
  it('finds a self-hosted target but ignores comments', () => {
    expect(mentionsSelfHosted('runs-on: [self-hosted, yekora-db]\n')).toBe(
      true
    );
    expect(
      mentionsSelfHosted('# never self-hosted here\nruns-on: ubuntu\n')
    ).toBe(false);
  });
});

describe('deployWorkflowViolations (FC 009 · K-13: API checks always on)', () => {
  const SMOKE = '- name: 🔥 Smoke test — apiv1.yekora.mx serves this commit';

  it('the real deploy.yml is conformant', () => {
    expect(deployWorkflowViolations(deploy)).toEqual([]);
  });

  it('flags the retired switch, a conditional smoke test and an optional catalog read', () => {
    const tampered = deploy
      .replace(SMOKE, `${SMOKE}\n        if: vars.API_LIVE == 'true'`)
      .replace(
        'CATALOG_API_URL: https://apiv1.yekora.mx',
        "CATALOG_API_URL: ${{ vars.API_LIVE == 'true' && 'https://apiv1.yekora.mx' || '' }}"
      );
    expect(deployWorkflowViolations(tampered)).toEqual([
      'the retired API_LIVE switch is back (K-13)',
      'the apiv1.yekora.mx smoke test must not be conditional',
      'the site build must always read the catalog from apiv1.yekora.mx',
    ]);
  });

  it('flags a conditional smoke test under any other condition', () => {
    const tampered = deploy.replace(SMOKE, `${SMOKE}\n        if: false`);
    expect(deployWorkflowViolations(tampered)).toEqual([
      'the apiv1.yekora.mx smoke test must not be conditional',
    ]);
  });

  it('flags a missing smoke test', () => {
    expect(
      deployWorkflowViolations(deploy.replace(SMOKE, '- name: other'))
    ).toContain('the apiv1.yekora.mx smoke test is missing');
  });
});

describe('deployWorkflowViolations (FC 025 · one job per layer)', () => {
  // The tampering below writes `\n`; a Windows checkout of the file may carry `\r\n`.
  const lf = deploy.replace(/\r\n/g, '\n');
  // global-certification's needs as Prettier prints it, and the same list on one line.
  const NEEDS_BLOCK = /( {4}needs:\n {6}\[\n)((?: {8}[\w-]+,\n)+)( {6}\])/;
  const ONE_LINE =
    '    needs: [frontend-validation, backend-validation, database-validation, security-scan, e2e-validation, sonar-scan]';

  it.each([
    [
      'the Backend job switched off again',
      (w: string) =>
        w.replace(
          '  backend-validation:\n',
          '  backend-validation:\n    if: false\n'
        ),
      ['the backend-validation job is switched off (if: false)'],
    ],
    [
      'the Database job moved off GitHub Ubuntu',
      (w: string) =>
        w.replace(
          '  database-validation:\n    name: 🏛️ Database (SQL) Verification\n    runs-on: ubuntu-24.04',
          '  database-validation:\n    name: 🏛️ Database (SQL) Verification\n    runs-on: ubuntu-22.04'
        ),
      ['the database-validation job must run on ubuntu-24.04'],
    ],
    [
      'the Database job on another MariaDB, without its real-SQL suite',
      (w: string) =>
        w
          .replace('image: mariadb:11.8.9', 'image: mariadb:10.4')
          .replace('vitest run --config vitest.db.config.ts', 'echo skipped'),
      [
        'the database-validation job must run: image: mariadb:11.8.9',
        'the database-validation job must run: vitest run --config vitest.db.config.ts',
      ],
    ],
    [
      'the Frontend job building the API again',
      (w: string) =>
        w.replace(
          '      - name: Upload TSC Result',
          '      - name: Build API bundle\n        run: bun run --cwd apps/api build\n      - name: Upload TSC Result'
        ),
      ['the frontend-validation job must not build or test apps/api'],
    ],
    [
      'the Frontend job running every test',
      (w: string) =>
        w.replace(
          'vitest run --config vitest.frontend.config.ts',
          'vitest run'
        ),
      [
        'the frontend-validation job must run: vitest run --config vitest.frontend.config.ts',
      ],
    ],
    [
      'a certification that no longer waits for the Database job',
      (w: string) => w.replace('        database-validation,\n', ''),
      ['global-certification must wait for: database-validation'],
    ],
    [
      'a one-line needs that leaves out the Backend job',
      (w: string) =>
        w.replace(NEEDS_BLOCK, ONE_LINE.replace('backend-validation, ', '')),
      ['global-certification must wait for: backend-validation'],
    ],
    [
      'a certification that waits for nothing',
      (w: string) => w.replace(NEEDS_BLOCK, ''),
      [
        'global-certification must wait for: frontend-validation, backend-validation, database-validation, security-scan, e2e-validation, sonar-scan',
      ],
    ],
    [
      'a missing Backend job',
      (w: string) => w.replace('  backend-validation:\n', '  api-checks:\n'),
      ['the backend-validation job is missing'],
    ],
  ])('flags %s', (_case, tamper, expected) => {
    const tampered = tamper(lf);
    expect(tampered).not.toBe(lf);
    expect(deployWorkflowViolations(tampered)).toEqual(expected);
  });

  it('accepts the full needs list on one line too', () => {
    expect(deployWorkflowViolations(lf.replace(NEEDS_BLOCK, ONE_LINE))).toEqual(
      []
    );
  });

  it('ignores apps/api in a comment of the Frontend job', () => {
    const commented = lf.replace(
      '      - name: Upload TSC Result',
      '      # The apps/api bundle is built by the Backend job.\n      - name: Upload TSC Result'
    );
    expect(deployWorkflowViolations(commented)).toEqual([]);
  });
});

describe('migrationsWorkflowViolations (T1.2 · R1)', () => {
  it('the real db-migrations.yml is conformant', () => {
    expect(migrationsWorkflowViolations(migrations, OWNER)).toEqual([]);
  });

  it('the real deploy.yml never reaches the self-hosted runner', () => {
    expect(mentionsSelfHosted(deploy)).toBe(false);
  });

  it.each([
    ['push', 'workflow_dispatch:\n  push:'],
    ['pull_request_target', 'workflow_dispatch:\n  pull_request_target:'],
    ['schedule', 'workflow_dispatch:\n  schedule:'],
  ])('flags an automatic trigger (%s)', (_event, triggers) => {
    const tampered = migrations.replace('workflow_dispatch:', triggers);
    expect(migrationsWorkflowViolations(tampered, OWNER)[0]).toMatch(
      /^triggers must be workflow_dispatch only/
    );
  });

  it('flags a missing environment, a missing actor guard and an unpinned action', () => {
    const tampered = migrations
      .replace('environment: production-db', 'environment: staging')
      .replace(`[ "$ACTOR" = "${OWNER}" ]`, 'true')
      .replace(/actions\/checkout@[0-9a-f]{40}/, 'actions/checkout@v5');
    expect(migrationsWorkflowViolations(tampered, OWNER)).toEqual([
      'the migrate job must run in environment production-db',
      `the actor guard for ${OWNER} is missing`,
      'actions/checkout@v5 is not pinned by full commit SHA',
    ]);
  });

  it('flags a run title that does not name the migration file', () => {
    const tampered = migrations.replace(
      'run-name: 🏛️ ${{ inputs.migration_file }}',
      'run-name: 🏛️ DB migrations'
    );
    expect(migrationsWorkflowViolations(tampered, OWNER)).toEqual([
      'the run title must name the migration file (Archon convention)',
    ]);
  });

  it.each([
    [
      'a fingerprint computed another way',
      'LINE=$(bun scripts/dbParityCheck.ts)',
      'LINE=$(mysql < scripts/sql/schemaFingerprint.sql)',
      'the schema fingerprint must come from scripts/dbParityCheck.ts',
    ],
    [
      'a fingerprint skipped on a skip run',
      "if: always() && steps.connect.outcome == 'success'",
      "if: steps.plan.outputs.decision == 'apply' && steps.connect.outcome == 'success'",
      'the schema fingerprint must run on apply and on skip',
    ],
    [
      'an apply that does not wait for the backup',
      "if: steps.plan.outputs.decision == 'skip' || steps.backup.outcome == 'success'",
      'if: always()',
      'an apply must wait for the backup, and a skip must still print its counters',
    ],
    [
      'a summary without the Rule 23 line',
      '| Huella de esquema PROD (Regla 23) |',
      '| Huella |',
      'the summary must print the Rule 23 fingerprint line',
    ],
    [
      'a verdict re-written in bash',
      'import { workflowVerdict } from "./scripts/lib/dbParity.ts"',
      'import { other } from "./x.ts"',
      'the T1.2 verdict must come from workflowVerdict (scripts/lib/dbParity.ts)',
    ],
  ])('FC 015 · flags %s', (_case, from, to, violation) => {
    expect(migrations).toContain(from);
    expect(
      migrationsWorkflowViolations(migrations.replace(from, to), OWNER)
    ).toEqual([violation]);
  });

  it('flags a workflow without triggers', () => {
    expect(migrationsWorkflowViolations('name: x\n', OWNER)[0]).toBe(
      'triggers must be workflow_dispatch only, found: none'
    );
  });

  it.each([
    [
      'migrate on a GitHub runner',
      'runs-on: [self-hosted, yekora-db]',
      'runs-on: ubuntu-24.04',
      'the migrate job must run on [self-hosted, yekora-db], found: ubuntu-24.04',
    ],
    [
      'migrate on another self-hosted label',
      'runs-on: [self-hosted, yekora-db]',
      'runs-on: [self-hosted, other]',
      'the migrate job must run on [self-hosted, yekora-db], found: [self-hosted, other]',
    ],
    [
      'authorize on the database host',
      'runs-on: ubuntu-24.04',
      'runs-on: [self-hosted, yekora-db]',
      'the authorize job must run on ubuntu-24.04, found: [self-hosted, yekora-db]',
    ],
    [
      'authorize without a runner',
      '    runs-on: ubuntu-24.04',
      '',
      'the authorize job must run on ubuntu-24.04, found: none',
    ],
  ])('FC 017 T2 · flags %s', (_case, from, to, violation) => {
    expect(migrations).toContain(from);
    expect(
      migrationsWorkflowViolations(migrations.replace(from, to), OWNER)
    ).toEqual([violation]);
  });

  it('FC 017 T2 · ignores runs-on outside the jobs block and keys of nested maps', () => {
    const extra = migrations
      .replace('jobs:', 'defaults:\n  runs-on-note:\n    runs-on: x\njobs:')
      .replace(
        '  migrate:',
        '  migrate:\n    strategy:\n      runs-on: nested'
      );
    expect(migrationsWorkflowViolations(extra, OWNER)).toEqual([]);
  });
});

const auditCron = readFileSync(
  '.github/workflows/dependency-audit-cron.yml',
  'utf8'
);
const dependabot = readFileSync('.github/dependabot.yml', 'utf8');

describe('auditCronViolations (FC 016 · daily dependency audit, A08)', () => {
  it('the real dependency-audit-cron.yml is conformant', () => {
    expect(auditCronViolations(auditCron)).toEqual([]);
  });

  it.each([
    [
      'a push trigger',
      'workflow_dispatch:',
      'workflow_dispatch:\n  push:',
      'triggers must be schedule and workflow_dispatch, found: push, schedule, workflow_dispatch',
    ],
    [
      'a floating runner',
      'runs-on: ubuntu-24.04',
      'runs-on: ubuntu-latest',
      'every job must run on ubuntu-24.04',
    ],
    [
      'an unpinned action',
      'actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd',
      'actions/checkout@v5',
      'actions/checkout@v5 is not pinned by full commit SHA',
    ],
    [
      'another audit command',
      'run: bun scripts/dependencyAuditGate.ts',
      'run: bun audit',
      'it must run scripts/dependencyAuditGate.ts',
    ],
    [
      'an Issue opened on every run',
      'if: failure()',
      'if: always()',
      'the security Issue must be opened only when the audit fails',
    ],
  ])('flags %s', (_case, from, to, violation) => {
    expect(auditCron).toContain(from);
    expect(auditCronViolations(auditCron.replace(from, to))).toEqual([
      violation,
    ]);
  });

  it('flags a self-hosted runner, which also fails the runner rule', () => {
    expect(
      auditCronViolations(
        auditCron.replace(
          'runs-on: ubuntu-24.04',
          'runs-on: [self-hosted, yekora-db]'
        )
      )
    ).toEqual([
      'every job must run on ubuntu-24.04',
      'it must never target a self-hosted runner',
    ]);
  });

  it('flags a workflow without triggers or jobs', () => {
    expect(auditCronViolations('name: x\n')).toEqual([
      'triggers must be schedule and workflow_dispatch, found: none',
      'every job must run on ubuntu-24.04',
      'it must run scripts/dependencyAuditGate.ts',
      'the security Issue must be opened only when the audit fails',
    ]);
  });
});

describe('dependabotViolations (FC 016 · Archon policy, T2)', () => {
  it('the real dependabot.yml is conformant', () => {
    expect(dependabotViolations(dependabot)).toEqual([]);
  });

  it.each([
    [
      'the npm ecosystem (would not update bun.lock)',
      '- package-ecosystem: bun',
      '- package-ecosystem: npm',
      'the ecosystem must be bun (it updates bun.lock)',
    ],
    [
      'majors allowed',
      '- version-update:semver-major',
      '- version-update:semver-patch',
      'major updates must be ignored for every dependency',
    ],
    [
      'majors ignored for one package only',
      "- dependency-name: '*'",
      "- dependency-name: 'next'",
      'major updates must be ignored for every dependency',
    ],
    [
      'a missing group',
      'production-patches:',
      'production-everything:',
      'the group production-patches is missing',
    ],
  ])('flags %s', (_case, from, to, violation) => {
    expect(dependabot).toContain(from);
    expect(dependabotViolations(dependabot.replace(from, to))).toEqual([
      violation,
    ]);
  });
});
