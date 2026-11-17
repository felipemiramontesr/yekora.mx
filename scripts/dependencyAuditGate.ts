/**
 * A06 · Dependency audit gate (FC 001, ported from Archon; FC 036: every severity blocks).
 * AuditPass ≡ no advisory without a current exception ∧ no expired or stale exception, over
 * `bun audit --json` (rule in scripts/lib/dependencyAuditGate.ts). Fail-closed: an unknown
 * severity blocks and a malformed report exits 1.
 * CLI: `bun scripts/dependencyAuditGate.ts` — exit 0 = PASS · exit 1 = FAIL.
 */
import { spawnSync } from 'node:child_process';
import { type AcceptedException, judgeAudit } from './lib/dependencyAuditGate';

// Exact allowlist by package + advisory id, only for advisories with no patched release.
// Widening it needs a signed FC (O/R/Ω). Empty since FC 036: the braces advisory (1240992) is
// no longer reported, so its exception was retired.
// 2026-11-17 (FC 054, Ω authorized it in the chat): picomatch ReDoS through repeated extglobs
// (GHSA-fc5q-39xc-vjpf), reported for every version up to 4.0.7 with no patched release. It only
// reaches the build tools (vite, vitest, tinyglobby, eslint, tailwind) and no code of the site or
// the API matches user input with it. Remove it as soon as picomatch 4.0.8 or later is published.
const ACCEPTED_EXCEPTIONS: readonly AcceptedException[] = [
  {
    packageName: 'picomatch',
    advisoryId: 1247710,
    reason:
      'No patched release (GHSA-fc5q-39xc-vjpf, <= 4.0.7); build tools only, no user input reaches it.',
    reviewBy: '2026-12-01',
  },
];

// process.execPath is the bun binary running this script: no lookup through PATH.
const result = spawnSync(process.execPath, ['audit', '--json'], {
  encoding: 'utf8',
});

try {
  // bun audit exits non-zero on any advisory; the verdict is decided here.
  const stdout = result.stdout.trim();
  const verdict = judgeAudit(
    JSON.parse(stdout === '' ? '{}' : stdout),
    ACCEPTED_EXCEPTIONS,
    new Date().toISOString().slice(0, 10)
  );
  const { counts } = verdict;
  console.log(
    `[AuditGate] critical=${counts.critical} · high=${counts.high} · moderate=${counts.moderate} · low=${counts.low} · info=${counts.info} · unknown=${counts.unknown} · excepted=${verdict.excepted.length}`
  );
  for (const f of verdict.blocking)
    console.error(
      `  - ${f.severity}: ${f.packageName} (${String(f.advisoryId)}) ${f.title}`
    );
  for (const e of verdict.expired)
    console.error(
      `  - exception expired on ${e.reviewBy}: ${e.packageName} ${e.advisoryId}`
    );
  for (const e of verdict.stale)
    console.error(
      `  - stale exception (advisory gone, remove it): ${e.packageName} ${e.advisoryId}`
    );
  if (!verdict.pass) {
    console.error(
      '[FAIL] AuditPass ≡ ⊥ — advisories or dead exceptions present.'
    );
    process.exit(1);
  }
  console.log(
    '[OK] AuditPass ≡ ⊤ (no advisory of any severity, no dead exception).'
  );
} catch (error) {
  console.error(
    '[FAIL] Audit report could not be parsed — fail-closed.',
    error
  );
  console.error(result.stderr);
  process.exit(1);
}
