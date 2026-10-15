/**
 * Yekora Global Certification dashboard (FC 001, ported from Archon).
 * Builds the GitHub Step Summary only from computed signals: JUnit shard reports,
 * tsc-result.json, dependent job results and the exit codes of the OWASP scripts.
 * No status string is written by hand.
 *
 * OWASP rule (FC 001): row = exit code of its script. 0 → PASSED, other → FAILED,
 * no script in Yekora → NOT_VERIFIED. NOT_VERIFIED is never painted as PASSED.
 * Exit code: 1 when a module fails or an evaluated OWASP category FAILS. NOT_VERIFIED
 * categories do not fail the job; while any remain, TOTAL reads "CERTIFICACIÓN PARCIAL".
 *
 * CLI: `bun scripts/generateCertificationDashboard.ts [all-results-dir]` → markdown on stdout.
 * Env: FRONTEND_RESULT, E2E_RESULT, SONAR_RESULT, SECURITY_RESULT (job results),
 *      A04_EXIT, A06_EXIT, A08_EXIT (script exit codes).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Status = 'PASSED' | 'FAILED' | 'NOT_VERIFIED';

interface TestTotals {
  passed: number;
  total: number;
}

const OWASP: ReadonlyArray<{ id: string; label: string; exitEnv?: string }> = [
  { id: 'A01', label: 'Broken Access Control' },
  { id: 'A02', label: 'Cryptographic Failures' },
  { id: 'A03', label: 'Injection (SQL/NoSQL)' },
  {
    id: 'A04',
    label: 'Insecure Design (controles SDLC Protocolo L)',
    exitEnv: 'A04_EXIT',
  },
  { id: 'A05', label: 'Security Misconfiguration' },
  {
    id: 'A06',
    label: 'Vulnerable and Outdated Components',
    exitEnv: 'A06_EXIT',
  },
  { id: 'A07', label: 'Identification and Authentication Failures' },
  {
    id: 'A08',
    label: 'Software and Data Integrity Failures (pipeline)',
    exitEnv: 'A08_EXIT',
  },
  { id: 'A09', label: 'Security Logging and Monitoring Failures' },
  { id: 'A10', label: 'Server-Side Request Forgery (SSRF)' },
];

function badge(status: Status): string {
  if (status === 'PASSED') return '✅ PASSED';
  if (status === 'FAILED') return '❌ FAILED';
  return '⚠️ NOT_VERIFIED';
}

function jobStatus(result: string | undefined): Status {
  if (result === 'success') return 'PASSED';
  if (result === 'failure' || result === 'cancelled') return 'FAILED';
  return 'NOT_VERIFIED';
}

function exitStatus(exitCode: string | undefined): Status {
  if (exitCode === undefined || exitCode === '') return 'NOT_VERIFIED';
  return exitCode === '0' ? 'PASSED' : 'FAILED';
}

// Light JUnit parsing: <testsuite tests="n" failures="f" errors="e">, no XML dependency.
function junitTotals(xml: string): TestTotals {
  let passed = 0;
  let total = 0;
  for (const match of xml.matchAll(/<testsuite\s([^>]*)>/g)) {
    const attribute = (name: string) =>
      Number(new RegExp(`${name}="(\\d+)"`).exec(match[1])?.[1] ?? 0);
    const tests = attribute('tests');
    total += tests;
    passed += tests - attribute('failures') - attribute('errors');
  }
  return { passed, total };
}

function shardTotals(dir: string, prefix: string): TestTotals {
  if (!existsSync(dir)) return { passed: 0, total: 0 };
  return readdirSync(dir)
    .filter((name) => name.startsWith(prefix))
    .map((name) => join(dir, name, 'test-results.xml'))
    .filter((path) => existsSync(path))
    .map((path) => junitTotals(readFileSync(path, 'utf8')))
    .reduce(
      (sum, t) => ({
        passed: sum.passed + t.passed,
        total: sum.total + t.total,
      }),
      {
        passed: 0,
        total: 0,
      }
    );
}

function tscErrors(dir: string): number | undefined {
  const path = join(dir, 'frontend-tsc-result', 'tsc-result.json');
  if (!existsSync(path)) return undefined;
  return Number(
    (JSON.parse(readFileSync(path, 'utf8')) as { errors?: number }).errors ?? 0
  );
}

function testStatus(totals: TestTotals): Status {
  if (totals.total === 0) return 'NOT_VERIFIED';
  return totals.passed === totals.total ? 'PASSED' : 'FAILED';
}

const resultsDir = process.argv[2] ?? 'all-results';
const frontend = shardTotals(resultsDir, 'frontend-results-shard-');
const errors = tscErrors(resultsDir);
let tsc: Status = 'NOT_VERIFIED';
if (errors !== undefined) tsc = errors === 0 ? 'PASSED' : 'FAILED';

// Required modules: anything other than PASSED fails the certification.
const modules: Array<{
  name: string;
  status: Status;
  tests: string;
  integrity: string;
}> = [
  {
    name: '🎨 Frontend (Next.js)',
    status: testStatus(frontend),
    tests: `${frontend.passed} / ${frontend.total}`,
    integrity:
      frontend.total === 0
        ? '0%'
        : `${Math.round((frontend.passed / frontend.total) * 100)}%`,
  },
  {
    name: '🏷️ Static Type Checking',
    status: tsc,
    tests: errors === undefined ? '—' : `${errors} Errors / 0 Warnings`,
    integrity: tsc === 'PASSED' ? '100%' : '0%',
  },
  {
    name: '🧪 E2E (Playwright)',
    status: jobStatus(process.env.E2E_RESULT),
    tests: '—',
    integrity: '—',
  },
  {
    name: '🔍 SonarQube + SonarSpotless',
    status: jobStatus(process.env.SONAR_RESULT),
    tests: '—',
    integrity: '—',
  },
  {
    name: '🔐 Secret Scan (TruffleHog)',
    status: jobStatus(process.env.SECURITY_RESULT),
    tests: '—',
    integrity: '—',
  },
];
const owasp = OWASP.map((category) => ({
  ...category,
  status: category.exitEnv
    ? exitStatus(process.env[category.exitEnv])
    : ('NOT_VERIFIED' as Status),
}));

const modulesOk = modules.every((m) => m.status === 'PASSED');
const owaspFailed = owasp.some((c) => c.status === 'FAILED');
const owaspComplete = owasp.every((c) => c.status === 'PASSED');
const certified = modulesOk && !owaspFailed;
let verdict = 'NO CERTIFICADO';
if (certified)
  verdict = owaspComplete ? 'CERTIFICADO' : 'CERTIFICACIÓN PARCIAL';

const lines = [
  '### 🔱 YEKORA CERTIFICATION DASHBOARD',
  '',
  '| Módulo | Estado | Tests Pasados | Integridad |',
  '| :--- | :---: | :---: | :---: |',
  ...modules.map(
    (m) => `| ${m.name} | ${badge(m.status)} | ${m.tests} | ${m.integrity} |`
  ),
  '| 🛡️ Backend (API) | ⏸️ SLOT RESERVADO | — | — |',
  '| 🏛️ Database (SQL) | ⏸️ SLOT RESERVADO | — | — |',
  `| **TOTAL** | **${verdict}** | **${frontend.passed} / ${frontend.total}** | **${certified ? 100 : 0}%** |`,
  '',
  '### 🛡️ OWASP SECURITY CERTIFICATION (TOP 10)',
  '',
  '| Categoría | Riesgo | Estado |',
  '| :--- | :--- | :---: |',
  ...owasp.map((c) => `| **${c.id}** | ${c.label} | ${badge(c.status)} |`),
  '',
  `_NOT_VERIFIED = sin control automatizado en Yekora todavía; nunca se muestra como PASSED._`,
];
console.log(lines.join('\n'));
if (!certified) process.exit(1);
