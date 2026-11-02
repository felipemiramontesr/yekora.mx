/**
 * Platform guards of FC 027 (ADR 0011 and ADR 0013), over committed files only.
 *   a) next.config.ts builds a static export (T2.4).
 *   b) Every SPA area the site has (`cuenta`, `admin`, in both languages) has its Apache
 *      fallback to its own index.html (T2.4). None exists before FC 028.
 *   c) No module of apps/api/src imports an SMTP client except the outbox dispatcher, and no
 *      route imports the dispatcher (T2.5).
 * CLI: `bun scripts/checkPlatformGuards.ts` — exit 0 = in place · exit 1 = a rule is broken.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { outboxViolations } from './lib/outboxValidation';
import {
  SPA_AREAS,
  spaFallbackViolations,
  staticExportViolations,
} from './lib/spaExportValidation';

/** Every .ts file under a directory, by repository path with forward slashes. */
function sources(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of readdirSync(dir, {
    withFileTypes: true,
    recursive: true,
  })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    const path = join(entry.parentPath, entry.name).replaceAll('\\', '/');
    files.set(path, readFileSync(path, 'utf8'));
  }
  return files;
}

const areas = SPA_AREAS.flatMap((area) => [
  ...(existsSync(join('app', '(es)', area)) ? [area] : []),
  ...(existsSync(join('app', '(en)', 'en', area)) ? [`en/${area}`] : []),
]);
const failures = [
  ...staticExportViolations(readFileSync('next.config.ts', 'utf8')).map(
    (v) => `a) ${v}`
  ),
  ...spaFallbackViolations(readFileSync('public/.htaccess', 'utf8'), areas).map(
    (v) => `b) ${v}`
  ),
  ...outboxViolations(sources('apps/api/src')).map((v) => `c) ${v}`),
];

if (failures.length > 0) {
  console.error('[FAIL] FC 027 platform guards:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(
  `[OK] FC 027 platform guards: static export, ${areas.length} SPA areas with their fallback, mail only through the outbox.`
);
