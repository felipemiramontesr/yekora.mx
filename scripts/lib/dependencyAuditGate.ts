/**
 * A06 · Dependency audit rule (FC 001, hardened by FC 036 T2.1): every advisory blocks.
 *
 * `bun audit --json` reports package → advisories. Since FC 036 a critical, high, moderate, low
 * or info advisory fails the gate alike, because one left alone is how ten of them piled up
 * (252_AN). The only way through is an accepted exception for an advisory that has no patched
 * release: exact package and advisory id, a reason and a review date. An expired exception
 * blocks again, and an exception whose advisory no longer appears must be removed, so the
 * allowlist never outlives its reason. An unknown severity or a malformed report fails closed.
 * Pure: the CLI is scripts/dependencyAuditGate.ts.
 *
 * @module
 */

/** Severities `bun audit` reports. */
const SEVERITIES = ['critical', 'high', 'moderate', 'low', 'info'] as const;

/** One severity, or `unknown` for anything else (fail-closed). */
export type Severity = (typeof SEVERITIES)[number] | 'unknown';

/** An advisory accepted because no patched release exists. Widening the list needs a signed FC. */
export interface AcceptedException {
  /** Package the advisory is about. */
  packageName: string;
  /** Advisory id as `bun audit --json` reports it. */
  advisoryId: number;
  /** Why it cannot be fixed yet, and where the package arrives from. */
  reason: string;
  /** Last day (YYYY-MM-DD) the exception holds; after it the advisory blocks again. */
  reviewBy: string;
}

/** One advisory of the report. */
export interface Finding {
  packageName: string;
  advisoryId: unknown;
  severity: Severity;
  title: string;
}

/** The gate's verdict over one report. */
export interface AuditVerdict {
  /** True when nothing blocks. */
  pass: boolean;
  /** Advisories that block, by severity first. */
  blocking: Finding[];
  /** Advisories let through by a current exception. */
  excepted: Finding[];
  /** Exceptions past their review date. */
  expired: AcceptedException[];
  /** Exceptions whose advisory is no longer reported. */
  stale: AcceptedException[];
  /** Blocking advisories per severity. */
  counts: Record<Severity, number>;
}

/** Advisories of one package, validated (fail-closed on anything that is not a list). */
function findingsOf(packageName: string, advisories: unknown): Finding[] {
  if (!Array.isArray(advisories)) {
    throw new TypeError(
      `Malformed audit report: advisories of ${packageName} is not a list`
    );
  }
  return advisories.map(
    (advisory: { severity?: unknown; id?: unknown; title?: unknown }) => ({
      packageName,
      advisoryId: advisory.id,
      severity: SEVERITIES.includes(advisory.severity as never)
        ? (advisory.severity as Severity)
        : 'unknown',
      title: typeof advisory.title === 'string' ? advisory.title : '',
    })
  );
}

/**
 * Judges a `bun audit --json` report (T2.1).
 *
 * @param report - Parsed report: package → advisories.
 * @param exceptions - Accepted exceptions.
 * @param today - Today as YYYY-MM-DD (UTC).
 * @returns What blocks, what an exception lets through, and which exceptions are dead.
 */
export function judgeAudit(
  report: unknown,
  exceptions: readonly AcceptedException[],
  today: string
): AuditVerdict {
  if (report === null || typeof report !== 'object' || Array.isArray(report)) {
    throw new TypeError(
      'Malformed audit report: expected an object of package → advisories'
    );
  }
  const findings = Object.entries(report).flatMap(([name, advisories]) =>
    findingsOf(name, advisories)
  );
  const matches = (e: AcceptedException, f: Finding) =>
    e.packageName === f.packageName && e.advisoryId === f.advisoryId;
  const current = exceptions.filter((e) => e.reviewBy >= today);
  const excepted = findings.filter((f) => current.some((e) => matches(e, f)));
  const blocking = findings.filter((f) => !excepted.includes(f));
  const counts = Object.fromEntries(
    [...SEVERITIES, 'unknown'].map((s) => [
      s,
      blocking.filter((f) => f.severity === s).length,
    ])
  ) as Record<Severity, number>;
  const expired = exceptions.filter((e) => e.reviewBy < today);
  const stale = exceptions.filter((e) => !findings.some((f) => matches(e, f)));
  return {
    pass: blocking.length === 0 && expired.length === 0 && stale.length === 0,
    blocking,
    excepted,
    expired,
    stale,
    counts,
  };
}
