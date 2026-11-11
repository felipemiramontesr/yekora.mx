/**
 * Platform guards of FC 027 (ADR 0011 and ADR 0013), over committed files only.
 *   a) next.config.ts builds a static export (T2.4).
 *   b) Every SPA area the site has (`cuenta` and `en/account`; `admin` and `en/admin`) has its
 *      Apache fallback to its own index.html (T2.4, FC 028 T2.6c).
 *   c) No module of apps/api/src imports an SMTP client except the outbox dispatcher, and no
 *      route imports the dispatcher (T2.5).
 *   d) FC 035 T1.2: no source of the site imports next/font/google or names a Google Fonts host,
 *      so the build never depends on Google answering.
 *   e) FC 044 T2.3: the owner's e-mail comes from OWNER_EMAIL at run time; only the provisioning
 *      service and script name the variable, and no file gives it an address.
 * CLI: `bun scripts/checkPlatformGuards.ts` — exit 0 = in place · exit 1 = a rule is broken.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { remoteFontViolations } from './lib/hermeticBuild';
import { outboxViolations } from './lib/outboxValidation';
import { ownerEmailViolations } from './lib/ownerHygiene';
import {
  SPA_AREAS,
  spaFallbackViolations,
  staticExportViolations,
} from './lib/spaExportValidation';

/**
 * Every .ts (and, when asked, .tsx) file under a directory, by repository path with "/"; with
 * `extensions`, the files that end in one of them instead.
 */
function sources(
  dir: string,
  tsx = false,
  extensions = tsx ? ['.ts', '.tsx'] : ['.ts']
): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of readdirSync(dir, {
    withFileTypes: true,
    recursive: true,
  })) {
    const typed = extensions.some((extension) =>
      entry.name.endsWith(extension)
    );
    if (!entry.isFile() || !typed) continue;
    const path = join(entry.parentPath, entry.name).replaceAll('\\', '/');
    files.set(path, readFileSync(path, 'utf8'));
  }
  return files;
}

const areas = SPA_AREAS.flatMap(({ es, en }) => [
  ...(existsSync(join('app', '(es)', es)) ? [es] : []),
  ...(existsSync(join('app', '(en)', 'en', en)) ? [`en/${en}`] : []),
]);
const failures = [
  ...staticExportViolations(readFileSync('next.config.ts', 'utf8')).map(
    (v) => `a) ${v}`
  ),
  ...spaFallbackViolations(readFileSync('public/.htaccess', 'utf8'), areas).map(
    (v) => `b) ${v}`
  ),
  ...outboxViolations(sources('apps/api/src')).map((v) => `c) ${v}`),
  ...remoteFontViolations(
    new Map(
      ['app', 'components', 'lib'].flatMap((dir) => [...sources(dir, true)])
    )
  ).map((v) => `d) ${v}`),
  ...ownerEmailViolations(
    new Map([
      ...['app', 'apps/api/src', 'components', 'e2e', 'lib', 'scripts'].flatMap(
        (dir) => [...sources(dir, true)]
      ),
      ...sources('migrations', false, ['.sql']),
      ...sources('.github', false, ['.yml']),
    ])
  ).map((v) => `e) ${v}`),
];

if (failures.length > 0) {
  console.error('[FAIL] FC 027 platform guards:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(
  `[OK] FC 027 platform guards: static export, ${areas.length} SPA areas with their fallback, mail only through the outbox, fonts from the repository.`
);
