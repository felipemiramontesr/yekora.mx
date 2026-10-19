/**
 * CI guard for ADR 0007 (FC 008): fails when any file in migrations/ declares an ENUM or SET
 * column type. Domain values belong in reference tables with a FK (truth table T1.4).
 * CLI: `bun scripts/checkNoEnum.ts` — exit 0 = compliant · exit 1 = findings printed.
 *
 * @module
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findEnumTypes } from './lib/noEnum';

const dir = join(process.cwd(), 'migrations');
const files = existsSync(dir)
  ? readdirSync(dir).filter((name) => name.endsWith('.sql'))
  : [];
const findings = files.flatMap((file) =>
  findEnumTypes(readFileSync(join(dir, file), 'utf8')).map(
    (finding) => `migrations/${file}:${finding.line} ${finding.type}(…)`
  )
);

if (findings.length > 0) {
  console.error(
    '[FAIL] ADR 0007: ENUM/SET column types are forbidden; use a reference table:'
  );
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exit(1);
}
console.log(
  `[OK] ADR 0007: no ENUM/SET across ${files.length} migration file(s).`
);
