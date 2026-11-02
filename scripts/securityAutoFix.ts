/**
 * Security auto-fix (FC 036 T2.2; plan in scripts/lib/securityAutoFix.ts). Run by the daily
 * audit when it fails: rewrites bun.lock with every patch fix and lists what waits for Ω.
 *   - Reads `bun audit --json` and bun.lock; asks the npm registry (HTTPS, 10 s each) for the
 *     published releases of each affected package.
 *   - Applies only patch fixes, then writes autofix-summary.md (PR body / issue comment).
 *   - Prints `applied=<n>` and `held=<n>` to $GITHUB_OUTPUT when it exists.
 * CLI: `bun scripts/securityAutoFix.ts` — exit 0 = planned (even if nothing applied) · exit 1 = error.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import {
  applyPatches,
  planFixes,
  type Release,
  vulnerableEntries,
} from './lib/securityAutoFix';

const report = JSON.parse(
  spawnSync(process.execPath, ['audit', '--json'], {
    encoding: 'utf8',
  }).stdout.trim() || '{}'
) as Record<string, { vulnerable_versions?: string }[]>;
const ranges = Object.fromEntries(
  Object.entries(report).map(([name, advisories]) => [
    name,
    advisories.map((advisory) => advisory.vulnerable_versions ?? '*'),
  ])
);

/** Published releases of one package, from the public npm registry. */
async function registry(name: string): Promise<Record<string, Release>> {
  const response = await fetch(
    `https://registry.npmjs.org/${name.replace('/', '%2F')}`,
    { signal: AbortSignal.timeout(10_000) }
  );
  if (!response.ok)
    throw new Error(`registry ${name}: HTTP ${response.status}`);
  const body = (await response.json()) as {
    versions: Record<
      string,
      { dist: { integrity: string }; dependencies?: Record<string, string> }
    >;
  };
  return Object.fromEntries(
    Object.entries(body.versions).map(([version, meta]) => [
      version,
      { integrity: meta.dist.integrity, dependencies: meta.dependencies ?? {} },
    ])
  );
}

const lock = readFileSync('bun.lock', 'utf8');
const plans = await planFixes(
  vulnerableEntries(lock, ranges),
  ranges,
  registry
);
const applied = plans.filter((plan) => plan.level === 'patch');
const held = plans.filter((plan) => plan.level !== 'patch');
if (applied.length > 0) writeFileSync('bun.lock', applyPatches(lock, plans));

const row = (p: (typeof plans)[number]) => {
  const why = p.blockedBy ? ` (${p.blockedBy})` : '';
  return `| \`${p.key}\` | ${p.version} | ${p.to ?? '—'} | ${p.level}${why} |`;
};
writeFileSync(
  'autofix-summary.md',
  [
    '## Auto-fix de seguridad (FC 036)',
    '',
    `Parches aplicados: ${applied.length} · Esperan a GrayMan (Ω): ${held.length}`,
    '',
    '| Entrada de bun.lock | Versión | Corrige en | Nivel |',
    '|---|---|---|---|',
    ...plans.map(row),
    '',
    'Solo los parches se integran solos, y solo con el CI completo en verde. Un minor o un major nunca se aplica aquí: requiere la aprobación de Ω.',
    '',
  ].join('\n')
);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `applied=${applied.length}\nheld=${held.length}\n`
  );
}
console.log(
  `[AutoFix] ${applied.length} patch(es) applied to bun.lock · ${held.length} waiting for Ω`
);
