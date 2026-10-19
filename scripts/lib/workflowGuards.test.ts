import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
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

  it('flags a workflow without triggers', () => {
    expect(migrationsWorkflowViolations('name: x\n', OWNER)[0]).toBe(
      'triggers must be workflow_dispatch only, found: none'
    );
  });
});
