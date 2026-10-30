/**
 * Yekora Global Certification dashboard (FC 001, rebuilt in FC 010 for parity with Archon).
 * Reads the CI signals, lets scripts/lib/certification.ts compute every status and prints the
 * GitHub Step Summary. No status string is written by hand, and the `status` field of
 * owaspCoverageMap.json (verifyL's) is never read.
 *
 * Signals:
 * - JUnit test cases of each layer job (FC 025): the Frontend shards
 *   (`all-results/frontend-results-shard-*`: site and CI tooling), `backend-results` (the API's
 *   unit tests) and `database-results` (the API's real SQL on MariaDB), split into the Frontend,
 *   Backend, Database and Tooling modules and matched to the OWASP evidence by file and describe
 *   block;
 * - tsc-result.json of the type check;
 * - job results: FRONTEND_RESULT, BACKEND_RESULT, DB_RESULT, E2E_RESULT, SONAR_RESULT (coverage
 *   100 % is enforced there) and SECURITY_RESULT;
 * - gate script exit codes: A03_EXIT, A04_EXIT, A06_EXIT, A08_EXIT.
 *
 * T2 (T1.4): exit 1 unless every module and every OWASP row is PASSED or RESERVED SLOT. FC 025
 * T1.3: each layer row needs its job green and its own tests green (`layerModule`).
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
  layerModule,
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

// The real-SQL suite lives under apps/api but belongs to the Database layer, not the Backend one.
const DB_SUITE = 'apps/api/src/db.integration.test.ts';

const reports = existsSync(resultsDir)
  ? readdirSync(resultsDir).filter(
      (name) =>
        name.startsWith('frontend-results-shard-') ||
        name === 'backend-results' ||
        name === 'database-results'
    )
  : [];
const cases = reports
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
  layerModule(
    '🎨 Frontend (Next.js)',
    cases,
    (file) => /^(app|components|lib)\//.test(file),
    env.FRONTEND_RESULT
  ),
  layerModule(
    '🛡️ Backend (API Fastify)',
    cases,
    (file) => file.startsWith('apps/api/') && file !== DB_SUITE,
    env.BACKEND_RESULT
  ),
  layerModule(
    '🏛️ Database (MariaDB · migrations & SQL)',
    cases,
    (file) => file === DB_SUITE,
    env.DB_RESULT
  ),
  testModule('🧰 CI Gates & Tooling (scripts)', cases, (file) =>
    file.startsWith('scripts/')
  ),
  {
    name: '🏷️ Static Type Checking (TypeScript)',
    status: tscStatus,
    detail: tscErrors === undefined ? undefined : `${tscErrors} Errors`,
  },
  // The Frontend job also gates lint, TSDoc and the audit for the whole repository; the API
  // bundle is built by the Backend job (FC 025).
  {
    name: '🧹 Lint · TSDoc · Audit (frontend job)',
    status: jobStatus(env.FRONTEND_RESULT),
  },
  { name: '🧪 E2E (Playwright · Apache)', status: jobStatus(env.E2E_RESULT) },
  { name: '🔍 SonarQube + SonarSpotless', status: jobStatus(env.SONAR_RESULT) },
  {
    name: '🔐 Secret Scan (TruffleHog)',
    status: jobStatus(env.SECURITY_RESULT),
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
