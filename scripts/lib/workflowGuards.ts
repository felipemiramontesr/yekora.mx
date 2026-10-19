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
  for (const uses of unpinnedActions(workflow)) {
    violations.push(`${uses} is not pinned by full commit SHA`);
  }
  return violations;
}
