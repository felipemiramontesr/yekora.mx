/**
 * A06 · Dependency audit gate (FC 001, ported from Archon).
 * AuditPass ≡ (critical = 0) ∧ (high = 0) over `bun audit --json` (package → advisories[]).
 * Fail-closed: an unknown severity counts as high and a malformed report exits 1.
 * Moderate and low advisories are reported but do not block.
 * CLI: `bun scripts/dependencyAuditGate.ts` — exit 0 = PASS · exit 1 = FAIL.
 */
import { spawnSync } from 'node:child_process';

const KNOWN_SEVERITIES = [
  'critical',
  'high',
  'moderate',
  'low',
  'info',
] as const;
type Severity = (typeof KNOWN_SEVERITIES)[number];
type SeverityCounts = Record<Severity, number>;

interface AcceptedException {
  packageName: string;
  advisoryId: number;
  reason: string;
  reviewBy: string;
}

// Exact allowlist by package + advisory id. Widening it needs a signed FC (O/R/Ω).
const ACCEPTED_EXCEPTIONS: readonly AcceptedException[] = [
  {
    packageName: 'braces',
    advisoryId: 1240992,
    reason:
      'GHSA-vfj7-8cjw-p6xm (DoS via nested patterns) in braces<=3.0.3 has no patched release ' +
      '(3.0.3 is the latest). It only arrives through tooling devDependencies ' +
      '(lint-staged, tailwindcss via micromatch/fast-glob/chokidar), never the app bundle. ' +
      'Same exception Archon ratified; remove it as soon as a fix ships.',
    reviewBy: '2027-01-03',
  },
];

function isAccepted(packageName: string, advisoryId: unknown): boolean {
  return ACCEPTED_EXCEPTIONS.some(
    (exception) =>
      exception.packageName === packageName &&
      exception.advisoryId === advisoryId
  );
}

function countBySeverity(report: unknown): SeverityCounts {
  if (report === null || typeof report !== 'object' || Array.isArray(report)) {
    throw new TypeError(
      'Malformed audit report: expected an object of package → advisories'
    );
  }
  const counts: SeverityCounts = {
    critical: 0,
    high: 0,
    moderate: 0,
    low: 0,
    info: 0,
  };
  for (const [packageName, advisories] of Object.entries(report)) {
    if (!Array.isArray(advisories)) {
      throw new TypeError(
        `Malformed audit report: advisories of ${packageName} is not a list`
      );
    }
    for (const advisory of advisories as Array<{
      severity?: unknown;
      id?: unknown;
    }>) {
      const severity = advisory.severity;
      const known = KNOWN_SEVERITIES.includes(severity as Severity);
      if (known && severity === 'high' && isAccepted(packageName, advisory.id))
        continue;
      if (known) counts[severity as Severity] += 1;
      else counts.high += 1;
    }
  }
  return counts;
}

// process.execPath is the bun binary running this script: no lookup through PATH.
const result = spawnSync(process.execPath, ['audit', '--json'], {
  encoding: 'utf8',
});

try {
  // bun audit exits non-zero on any advisory; the T2 threshold is decided here.
  const stdout = result.stdout.trim();
  const counts = countBySeverity(JSON.parse(stdout === '' ? '{}' : stdout));
  console.log(
    `[AuditGate] critical=${counts.critical} · high=${counts.high} · moderate=${counts.moderate} · low=${counts.low} · info=${counts.info}`
  );
  for (const exception of ACCEPTED_EXCEPTIONS) {
    console.log(
      `[AuditGate] accepted exception: ${exception.packageName} advisory ${exception.advisoryId} — review before ${exception.reviewBy}`
    );
  }
  if (counts.critical > 0 || counts.high > 0) {
    console.error('[FAIL] AuditPass ≡ ⊥ — critical/high advisories present.');
    console.error(result.stdout);
    process.exit(1);
  }
  console.log('[OK] AuditPass ≡ ⊤ (critical = 0 ∧ high = 0).');
} catch (error) {
  console.error(
    '[FAIL] Audit report could not be parsed — fail-closed.',
    error
  );
  console.error(result.stderr);
  process.exit(1);
}
