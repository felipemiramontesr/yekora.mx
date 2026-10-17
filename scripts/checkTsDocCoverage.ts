/**
 * TSDoc coverage gate (FC 006, invariant I-TSDoc-Coverage):
 *   ∀ e ∈ PublicExports(app ∪ components ∪ lib) \ (TestFiles ∪ FrameworkConventions) : HasValidTsDoc(e)
 *
 * Fails the build when an exported declaration of product code has no TSDoc block or a
 * malformed one (rules in scripts/lib/tsdoc.ts). Framework exceptions come from the same
 * module DC4 uses (scripts/lib/sourceFiles.ts), so both gates agree on what is project API.
 * CLI: `bun scripts/checkTsDocCoverage.ts` — exit 0 = 100 % · exit 1 = findings printed.
 *
 * @module
 */
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import {
  FRAMEWORK_EXPORTS,
  isAppRouterFile,
  productSourceFiles,
} from './lib/sourceFiles';
import { checkTsDoc } from './lib/tsdoc';

const root = process.cwd();
let checked = 0;
const failures: string[] = [];

for (const file of productSourceFiles(root)) {
  const report = checkTsDoc(file, readFileSync(file, 'utf8'), {
    frameworkFile: isAppRouterFile(root, file),
    frameworkExports: FRAMEWORK_EXPORTS,
  });
  checked += report.checked;
  for (const finding of report.findings) {
    failures.push(
      `${relative(root, file)}:${finding.line} ${finding.name} — ${finding.reason}`
    );
  }
}

const documented = checked - failures.length;
const coverage = checked === 0 ? 100 : (documented / checked) * 100;
const summary = `${documented}/${checked} exports documented (${coverage.toFixed(1)} %)`;

if (failures.length > 0) {
  console.error(`[FAIL] TSDoc coverage: ${summary}`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`[OK] TSDoc coverage: ${summary}.`);
