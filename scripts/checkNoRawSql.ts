/**
 * CI guard against SQL injection (FC 008, OWASP A03, truth table T1.1): every `.query(...)` /
 * `.execute(...)` in apps/api/src must receive static SQL text; values go in the parameter
 * array. Tests are excluded.
 *
 * No file is exempt: the only exceptions are single calls in the audited ALLOWLIST of
 * scripts/lib/rawSql.ts (signed FC required), and a stale entry fails as well.
 * CLI: `bun scripts/checkNoRawSql.ts` — exit 0 = safe · exit 1 = findings printed.
 *
 * @module
 */
import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { ALLOWLIST, applyAllowlist, findRawSql } from './lib/rawSql';
import { isTestFile, walk } from './lib/sourceFiles';

const root = process.cwd();

const files = walk(join(root, 'apps', 'api', 'src')).filter(
  (file) => /\.tsx?$/.test(file) && !isTestFile(file)
);
const findings = new Map(
  files.map((file) => [
    relative(root, file).split(sep).join('/'),
    findRawSql(file, readFileSync(file, 'utf8')),
  ])
);
const { violations, staleEntries } = applyAllowlist(findings, ALLOWLIST);

if (violations.length > 0 || staleEntries.length > 0) {
  console.error(
    '[FAIL] OWASP A03: SQL must be static text with ? placeholders:'
  );
  for (const violation of violations) console.error(`  - ${violation}`);
  for (const entry of staleEntries) {
    console.error(
      `  - stale ALLOWLIST entry (matches nothing): ${entry.file} ${entry.argument}`
    );
  }
  process.exit(1);
}
console.log(
  `[OK] OWASP A03: static, parameterized SQL across ${files.length} API file(s) · ${ALLOWLIST.length} audited exception(s).`
);
