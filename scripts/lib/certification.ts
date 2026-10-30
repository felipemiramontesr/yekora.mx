/**
 * Certification dashboard logic (FC 010, parity with Archon). Every status is computed from CI
 * signals: JUnit test cases, gate script exit codes and job results. The `status` field of
 * owaspCoverageMap.json exists for verifyL only and is never read here.
 *
 * Truth tables:
 * - T1.1 CategoryPassed ⟺ E ∧ F: evidence exists in CI and all of it is green;
 * - T1.2 ReservedValid ⟺ S ∧ C: a `reserved` category is RESERVED only while its guard passes;
 * - T1.4 Certified ⟺ M ∧ O: every module and every category is PASSED or RESERVED.
 *
 * @module
 */

/** Computed state of a module or a category. */
export type Status = 'PASSED' | 'FAILED' | 'NOT_VERIFIED' | 'RESERVED';

/** Outcome of one JUnit test case. */
type Outcome = 'passed' | 'failed' | 'skipped';

/** One test case of a JUnit report. */
export interface JunitCase {
  /** Test file, relative to the repository root (the testsuite name). */
  file: string;
  /** Full name, `describe > … > it`. */
  name: string;
  /** Result of the case. */
  outcome: Outcome;
}

/** One piece of evidence of a category, as declared in owaspCoverageMap.json. */
export type Evidence =
  | { type: 'junit'; path: string; describe?: string }
  | { type: 'script'; path: string; exitEnv: string }
  | { type: 'job'; job: string; resultEnv: string };

/** One row of the OWASP table. */
export interface Category {
  /** Row id: A01 … A10 or an extension such as YekoraALE. */
  id: string;
  /** Risk shown in the table. */
  label: string;
  /** `computed`, or `reserved` while the surface does not exist (T1.2). */
  method: 'computed' | 'reserved';
  /** Signals that decide the row; empty evidence is never PASSED. */
  evidence: Evidence[];
}

/** Environment variables carrying exit codes and job results. */
type Env = Readonly<Record<string, string | undefined>>;

const ENTITIES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&amp;': '&',
};

/** Decodes the five XML entities JUnit writers emit. */
function decodeXml(text: string): string {
  return text.replaceAll(
    /&(lt|gt|quot|apos|amp);/g,
    (entity) => ENTITIES[entity]
  );
}

/** Value of an XML attribute, decoded, or '' when absent. */
function attribute(tag: string, name: string): string {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return decodeXml(match?.[1] ?? '');
}

/**
 * Parses every test case of a JUnit report (Vitest format: one testsuite per file, testcase
 * `classname` = file). A case with `<failure>` or `<error>` failed; one with `<skipped>` did not
 * run and therefore proves nothing.
 *
 * @param xml - Contents of a test-results.xml.
 */
export function parseJunitCases(xml: string): JunitCase[] {
  const cases: JunitCase[] = [];
  const testcase = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  for (const match of xml.matchAll(testcase)) {
    const body = match[3] ?? '';
    let outcome: Outcome = 'passed';
    if (/<(failure|error)\b/.test(body)) outcome = 'failed';
    else if (/<skipped\b/.test(body)) outcome = 'skipped';
    cases.push({
      file: attribute(match[1], 'classname'),
      name: attribute(match[1], 'name'),
      outcome,
    });
  }
  return cases;
}

/** PASSED when every case ran green, FAILED on any failure, NOT_VERIFIED when none ran. */
function casesStatus(cases: readonly JunitCase[]): Status {
  if (cases.some((c) => c.outcome === 'failed')) return 'FAILED';
  if (cases.length === 0 || cases.some((c) => c.outcome === 'skipped')) {
    return 'NOT_VERIFIED';
  }
  return 'PASSED';
}

/**
 * Status of a CI job from its `needs.<job>.result`.
 *
 * @param result - `success`, `failure`, `cancelled`, `skipped` or undefined.
 */
export function jobStatus(result: string | undefined): Status {
  if (result === 'success') return 'PASSED';
  if (result === 'failure' || result === 'cancelled') return 'FAILED';
  return 'NOT_VERIFIED';
}

/** Status of a gate script from its exit code; no code means it did not run. */
function exitStatus(code: string | undefined): Status {
  if (code === undefined || code === '') return 'NOT_VERIFIED';
  return code === '0' ? 'PASSED' : 'FAILED';
}

/** Status of one piece of evidence. */
function evidenceStatus(
  evidence: Evidence,
  cases: readonly JunitCase[],
  env: Env
): Status {
  if (evidence.type === 'script') return exitStatus(env[evidence.exitEnv]);
  if (evidence.type === 'job') return jobStatus(env[evidence.resultEnv]);
  const prefix =
    evidence.describe === undefined ? '' : `${evidence.describe} > `;
  return casesStatus(
    cases.filter((c) => c.file === evidence.path && c.name.startsWith(prefix))
  );
}

/**
 * T1.1 and T1.2: a category is PASSED only when it has evidence and all of it is green; any red
 * piece makes it FAILED; anything missing leaves it NOT_VERIFIED. A `reserved` category whose
 * guard is green shows as RESERVED instead of PASSED.
 *
 * @param category - Row of the map.
 * @param cases - All JUnit cases of the run.
 * @param env - Exit codes and job results.
 */
export function categoryStatus(
  category: Category,
  cases: readonly JunitCase[],
  env: Env
): Status {
  const statuses = category.evidence.map((e) => evidenceStatus(e, cases, env));
  let status: Status = 'PASSED';
  if (statuses.includes('FAILED')) status = 'FAILED';
  else if (statuses.length === 0 || statuses.some((s) => s !== 'PASSED')) {
    status = 'NOT_VERIFIED';
  }
  return category.method === 'reserved' && status === 'PASSED'
    ? 'RESERVED'
    : status;
}

/** Badge shown for a status. */
export function badge(status: Status): string {
  if (status === 'PASSED') return '✅ PASSED';
  if (status === 'FAILED') return '❌ FAILED';
  if (status === 'RESERVED') return '⏸️ RESERVED SLOT';
  return '⚠️ NOT_VERIFIED';
}

/** Passed and total test cases. */
interface Totals {
  passed: number;
  total: number;
}

/** One row of the module table. */
export interface ModuleRow {
  /** Name with its icon. */
  name: string;
  /** Computed status. */
  status: Status;
  /** Test counts, when the module is measured by tests. */
  totals?: Totals;
  /** Free text for the tests column when there are no counts. */
  detail?: string;
}

/**
 * Module row measured by the JUnit cases whose file matches `owns`: PASSED only with at least
 * one case and every case green.
 *
 * @param name - Name with its icon.
 * @param cases - All JUnit cases of the run.
 * @param owns - Which files belong to the module.
 */
export function testModule(
  name: string,
  cases: readonly JunitCase[],
  owns: (file: string) => boolean
): ModuleRow {
  const own = cases.filter((c) => owns(c.file));
  const passed = own.filter((c) => c.outcome === 'passed').length;
  return {
    name,
    status: casesStatus(own),
    totals: { passed, total: own.length },
  };
}

/**
 * FC 025 T1.3: a layer (Frontend, Backend, Database) is PASSED only when its job finished green
 * and its own test cases did too. Green tests inside a red job, or a green job whose tests never
 * reached the report, are not certified.
 *
 * @param name - Name with its icon.
 * @param cases - All JUnit cases of the run.
 * @param owns - Which files belong to the layer.
 * @param jobResult - `needs.<job>.result` of the layer's job.
 */
export function layerModule(
  name: string,
  cases: readonly JunitCase[],
  owns: (file: string) => boolean,
  jobResult: string | undefined
): ModuleRow {
  const tests = testModule(name, cases, owns);
  const job = jobStatus(jobResult);
  let status: Status = 'PASSED';
  if (tests.status === 'FAILED' || job === 'FAILED') status = 'FAILED';
  else if (tests.status !== 'PASSED' || job !== 'PASSED') {
    status = 'NOT_VERIFIED';
  }
  return { ...tests, status };
}

/** Everything the dashboard shows. */
export interface DashboardInput {
  /** Module table rows. */
  modules: ModuleRow[];
  /** OWASP rows with their computed status. */
  categories: Array<{ id: string; label: string; status: Status }>;
}

const ACCEPTED: ReadonlySet<Status> = new Set(['PASSED', 'RESERVED']);

/**
 * T1.4: certified only when every module and every category is PASSED or RESERVED.
 *
 * @param input - Computed rows.
 */
export function isCertified(input: DashboardInput): boolean {
  return (
    input.modules.every((m) => ACCEPTED.has(m.status)) &&
    input.categories.every((c) => ACCEPTED.has(c.status))
  );
}

/** Percentage of passed cases, rounded. */
function integrity(totals: Totals): string {
  return totals.total === 0
    ? '0%'
    : `${Math.round((totals.passed / totals.total) * 100)}%`;
}

/**
 * Markdown of the GitHub Step Summary: module table with the total, then the OWASP table.
 *
 * @param input - Computed rows.
 */
export function renderDashboard(input: DashboardInput): string {
  const certified = isCertified(input);
  const measured = input.modules.flatMap((m) => (m.totals ? [m.totals] : []));
  const total = measured.reduce(
    (sum, t) => ({ passed: sum.passed + t.passed, total: sum.total + t.total }),
    { passed: 0, total: 0 }
  );
  const moduleLine = (m: ModuleRow) =>
    m.totals
      ? `| ${m.name} | ${badge(m.status)} | ${m.totals.passed} / ${m.totals.total} | ${integrity(m.totals)} |`
      : `| ${m.name} | ${badge(m.status)} | ${m.detail ?? '—'} | — |`;
  return [
    '### 🔱 YEKORA CERTIFICATION DASHBOARD',
    '',
    '| Módulo | Estado | Tests Pasados | Integridad |',
    '| :--- | :---: | :---: | :---: |',
    ...input.modules.map(moduleLine),
    `| **TOTAL** | **${certified ? 'CERTIFICADO' : 'NO CERTIFICADO'}** | **${total.passed} / ${total.total}** | **${certified ? 100 : 0}%** |`,
    '',
    '### 🛡️ OWASP SECURITY CERTIFICATION (TOP 10)',
    '',
    '| Categoría | Riesgo | Estado |',
    '| :--- | :--- | :---: |',
    ...input.categories.map(
      (c) => `| **${c.id}** | ${c.label} | ${badge(c.status)} |`
    ),
  ].join('\n');
}
