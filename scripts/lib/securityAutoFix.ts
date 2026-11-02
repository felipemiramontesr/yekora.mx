/**
 * Security auto-fix planner (FC 036 T2.2, Ω's option a): turns a `bun audit --json` report into
 * the smallest safe change to bun.lock, and says which advisories need Ω instead.
 *
 * For every locked version an advisory covers, the fix is the lowest published release of the
 * same major and minor that no advisory of that package covers. That is a patch: the lockfile
 * entry is rewritten in place (version and integrity) and nothing else moves. It is applied only
 * when the new release declares the same dependencies, so no package enters the tree unseen.
 * Anything else (a fix that needs a minor or major jump, or new dependencies) is never applied:
 * it is listed for Ω, because only patches may merge on their own.
 * Pure: the registry is passed in; the CLI is scripts/securityAutoFix.ts.
 *
 * @module
 */

/** One release as the npm registry describes it. */
export interface Release {
  /** Subresource integrity of the tarball. */
  integrity: string;
  /** Declared runtime dependencies. */
  dependencies: Record<string, string>;
}

/** Published releases of one package, by version. */
export type Registry = (name: string) => Promise<Record<string, Release>>;

/** One lockfile entry an advisory covers. */
export interface LockedVersion {
  /** Key of the entry in bun.lock (`fast-uri`, `ajv-formats/ajv/fast-uri`). */
  key: string;
  /** Package name. */
  name: string;
  /** Locked version. */
  version: string;
}

/** How big a jump the fix needs; `none` when no published release fixes it. */
export type FixLevel = 'patch' | 'minor' | 'major' | 'none';

/** The fix of one locked version. */
export interface PlannedFix extends LockedVersion {
  /** Version that fixes it, or null when no published release does. */
  to: string | null;
  /** Only `patch` is applied; the rest wait for Ω. */
  level: FixLevel;
  /** Integrity of `to`, when it is applied. */
  integrity?: string;
  /** Why a patch release cannot be applied on its own. */
  blockedBy?: string;
}

type Triple = [number, number, number];

/** Major, minor and patch of a version; a prerelease tag is ignored. */
function parse(version: string): Triple {
  const [major = 0, minor = 0, patch = 0] = version
    .replace(/^[v=]/, '')
    .split('-')[0]
    .split('.')
    .map(Number);
  return [major, minor, patch];
}

/**
 * Orders two versions.
 *
 * @param a - First version.
 * @param b - Second version.
 * @returns Negative, zero or positive, as a sort comparator.
 */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [parse(a), parse(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

const OPERATORS: Readonly<Record<string, (c: number) => boolean>> = {
  '>=': (c) => c >= 0,
  '>': (c) => c > 0,
  '<=': (c) => c <= 0,
  '<': (c) => c < 0,
  '=': (c) => c === 0,
};

/** Whether a version satisfies one comparator (`>=4.0.0`, `<11.0.1`, `1.2.3`). */
function satisfies(version: string, comparator: string): boolean {
  const operator = ['>=', '<=', '>', '<', '='].find((op) =>
    comparator.startsWith(op)
  );
  const bound = comparator.slice(operator?.length ?? 0);
  return OPERATORS[operator ?? '='](compareVersions(version, bound));
}

/**
 * Whether a version lies in an advisory range.
 *
 * @param version - Version to test.
 * @param range - Comparators joined by spaces (and), alternatives joined by `||` (or).
 * @returns True when the version is covered.
 */
export function inRange(version: string, range: string): boolean {
  return range.split('||').some((alternative) =>
    alternative
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .every((comparator) => satisfies(version, comparator))
  );
}

/**
 * Every lockfile entry an advisory covers.
 *
 * @param lock - Text of bun.lock.
 * @param ranges - Vulnerable ranges per package (from the audit report).
 * @returns The covered entries, in lockfile order.
 */
export function vulnerableEntries(
  lock: string,
  ranges: Readonly<Record<string, readonly string[]>>
): LockedVersion[] {
  const entries: LockedVersion[] = [];
  for (const line of lock.split('\n')) {
    // `    "key": ["name@version", …` — a scoped name keeps its leading @.
    const match = /^ {4}"([^"]+)": \["(@?[^@"]+)@([^"]+)"/.exec(line);
    if (match === null) continue;
    const [, key, name, version] = match;
    if ((ranges[name] ?? []).some((range) => inRange(version, range)))
      entries.push({ key, name, version });
  }
  return entries;
}

const sameDependencies = (a: Release, b: Release) =>
  JSON.stringify(Object.entries(a.dependencies).sort()) ===
  JSON.stringify(Object.entries(b.dependencies).sort());

/** The fix of one entry, given its package's releases. */
function planOne(
  entry: LockedVersion,
  ranges: readonly string[],
  releases: Record<string, Release>
): PlannedFix {
  const [major, minor] = parse(entry.version);
  const safe = Object.keys(releases)
    .filter((v) => !v.includes('-') && compareVersions(v, entry.version) > 0)
    .filter((v) => !ranges.some((range) => inRange(v, range)))
    .sort(compareVersions);
  const patch = safe.find((v) => {
    const [x, y] = parse(v);
    return x === major && y === minor;
  });
  if (patch === undefined) {
    const to = safe[0] ?? null;
    if (to === null) return { ...entry, to, level: 'none' };
    return { ...entry, to, level: parse(to)[0] === major ? 'minor' : 'major' };
  }
  const current = releases[entry.version];
  if (current === undefined || !sameDependencies(current, releases[patch])) {
    return {
      ...entry,
      to: patch,
      level: 'minor',
      blockedBy: `${entry.name}@${patch} does not declare the same dependencies`,
    };
  }
  return {
    ...entry,
    to: patch,
    level: 'patch',
    integrity: releases[patch].integrity,
  };
}

/**
 * Plans the fix of each covered entry (T2.2): a patch when one exists, else the level Ω approves.
 *
 * @param entries - Covered lockfile entries.
 * @param ranges - Vulnerable ranges per package.
 * @param registry - Published releases.
 * @returns One planned fix per entry.
 */
export async function planFixes(
  entries: readonly LockedVersion[],
  ranges: Readonly<Record<string, readonly string[]>>,
  registry: Registry
): Promise<PlannedFix[]> {
  const plans: PlannedFix[] = [];
  for (const entry of entries) {
    plans.push(
      planOne(entry, ranges[entry.name] ?? [], await registry(entry.name))
    );
  }
  return plans;
}

/**
 * Rewrites the lockfile entry of each patch fix: version and integrity, nothing else.
 *
 * @param lock - Text of bun.lock.
 * @param plans - Planned fixes; only `patch` ones are applied.
 * @returns The new lockfile text.
 */
export function applyPatches(
  lock: string,
  plans: readonly PlannedFix[]
): string {
  const patches = plans.filter((plan) => plan.level === 'patch');
  return lock
    .split('\n')
    .map((line) => {
      const plan = patches.find((p) =>
        line.startsWith(`    "${p.key}": ["${p.name}@${p.version}"`)
      );
      if (plan === undefined) return line;
      return line
        .replace(`"${plan.name}@${plan.version}"`, `"${plan.name}@${plan.to}"`)
        .replace(/"sha512-[^"]+"\]/, `"${plan.integrity}"]`);
    })
    .join('\n');
}
