/**
 * Yekora Global Certification dashboard (FC 001, rebuilt in FC 010 for parity with Archon).
 * Reads the CI signals, lets scripts/lib/certification.ts compute every status and prints the
 * GitHub Step Summary. No status string is written by hand, and the `status` field of
 * owaspCoverageMap.json (verifyL's) is never read.
 *
 * Signals:
 * - JUnit test cases of every Vitest shard (`all-results/frontend-results-shard-*`), split into
 *   the Frontend, Backend (apps/api) and Tooling (scripts) modules and matched to the OWASP
 *   evidence by file and describe block;
 * - tsc-result.json of the type check;
 * - job results: FRONTEND_RESULT, E2E_RESULT, SONAR_RESULT (coverage 100 % is enforced there),
 *   SECURITY_RESULT, and DB_RESULT only from a workflow
 *   that ran migrations (absent here, so Database is RESERVED SLOT, never PASSED);
 * - gate script exit codes: A03_EXIT, A04_EXIT, A06_EXIT, A08_EXIT.
 *
 * T2 (T1.4): exit 1 unless every module and every OWASP row is PASSED or RESERVED SLOT.
 *
 * CLI: `bun scripts/generateCertificationDashboard.ts [all-results-dir]` → markdown on stdout.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Category,
  categoryStatus,
  isCertified,
  jobStatus,
  type ModuleRow,
  parseJunitCases,
  renderDashboard,
  testModule,
} from './lib/certification';

// Extension rows after A01–A10, as Archon's ArchonALE. They live here, not in the map, because
// verifyL validates the map's domain as exactly A01–A10.
const EXTENSIONS: Category[] = [
  {
    id: 'YekoraALE',
    label: 'Application-Level Encryption',
    method: 'computed',
    evidence: [{ type: 'junit', path: 'scripts/lib/backupCrypto.test.ts' }],
  },
];

const resultsDir = process.argv[2] ?? 'all-results';
const env = process.env;

const shards = existsSync(resultsDir)
  ? readdirSync(resultsDir).filter((name) =>
      name.startsWith('frontend-results-shard-')
    )
  : [];
const cases = shards
  .map((name) => join(resultsDir, name, 'test-results.xml'))
  .filter((path) => existsSync(path))
  .flatMap((path) => parseJunitCases(readFileSync(path, 'utf8')));

const tscPath = join(resultsDir, 'frontend-tsc-result', 'tsc-result.json');
const tscErrors = existsSync(tscPath)
  ? Number(
      (JSON.parse(readFileSync(tscPath, 'utf8')) as { errors?: number })
        .errors ?? 0
    )
  : undefined;
let tscStatus: ModuleRow['status'] = 'NOT_VERIFIED';
if (tscErrors !== undefined) tscStatus = tscErrors === 0 ? 'PASSED' : 'FAILED';

const modules: ModuleRow[] = [
  testModule('🎨 Frontend (Next.js)', cases, (file) =>
    /^(app|components|lib)\//.test(file)
  ),
  testModule('🛡️ Backend (API Fastify)', cases, (file) =>
    file.startsWith('apps/api/')
  ),
  testModule('🧰 CI Gates & Tooling (scripts)', cases, (file) =>
    file.startsWith('scripts/')
  ),
  {
    name: '🏷️ Static Type Checking (TypeScript)',
    status: tscStatus,
    detail: tscErrors === undefined ? undefined : `${tscErrors} Errors`,
  },
  // The verification job also gates lint, TSDoc, the audit and the API bundle: green tests
  // inside a red job must not read as certified.
  {
    name: '🧹 Lint · TSDoc · API build (verification job)',
    status: jobStatus(env.FRONTEND_RESULT),
  },
  { name: '🧪 E2E (Playwright · Apache)', status: jobStatus(env.E2E_RESULT) },
  { name: '🔍 SonarQube + SonarSpotless', status: jobStatus(env.SONAR_RESULT) },
  {
    name: '🔐 Secret Scan (TruffleHog)',
    status: jobStatus(env.SECURITY_RESULT),
  },
  {
    name: '🏛️ Database (MariaDB · migrations)',
    status: env.DB_RESULT === undefined ? 'RESERVED' : jobStatus(env.DB_RESULT),
    detail:
      env.DB_RESULT === undefined ? 'no migration in this run' : undefined,
  },
];

const map = JSON.parse(readFileSync('owaspCoverageMap.json', 'utf8')) as {
  domain: string[];
  categories: Record<string, Omit<Category, 'id'>>;
};
const categories = [
  // The row shows the map key (A01), not the long id field (A01:2021).
  ...map.domain.map((id) => ({ ...map.categories[id], id })),
  ...EXTENSIONS,
].map((category) => ({
  id: category.id,
  label: category.label,
  status: categoryStatus(category, cases, env),
}));

const input = { modules, categories };
console.log(renderDashboard(input));
if (!isCertified(input)) process.exit(1);
