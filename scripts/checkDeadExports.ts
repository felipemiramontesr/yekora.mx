/**
 * DC4 · Dead exports guard (FC 001), adapted to the Next.js App Router.
 * Scans named exports in app/, components/ and lib/ and fails when one is not referenced
 * by any other non-test source file.
 * Whitelist: App Router convention files (page, layout, route, …) are wired by the framework,
 * not by imports, and so are the route segment exports listed in FRAMEWORK_EXPORTS.
 * FC 003 F2: also fails when a file in public/ is not referenced by its URL path from any
 * non-test source file, since everything in public/ is published to yekora.mx. Server
 * configuration files (SERVER_FILES) are read by Apache, not by the site.
 * CLI: `bun scripts/checkDeadExports.ts` — exit 0 = no dead exports · exit 1 = orphans found.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';

const root = process.cwd();
const SOURCE_DIRS = ['app', 'components', 'lib'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);
const PUBLIC_DIR = 'public';
const SERVER_FILES = new Set(['.htaccess']);
const APP_ROUTER_FILES = new Set([
  'page',
  'layout',
  'template',
  'not-found',
  'error',
  'global-error',
  'loading',
  'default',
  'route',
]);
const FRAMEWORK_EXPORTS = new Set([
  'metadata',
  'generateMetadata',
  'generateStaticParams',
  'viewport',
  'generateViewport',
  // Route segment config read by Next.js (e.g. app/[locale]: 404 for unsupported locales).
  'dynamicParams',
]);

const MODIFIERS = new Set(['declare', 'async']);
const DECLARATION_KEYWORDS = new Set([
  'const',
  'let',
  'var',
  'function',
  'function*',
  'class',
  'type',
  'interface',
  'enum',
]);

function isTestFile(path: string): boolean {
  return /\.(test|spec)\.tsx?$/.test(path) || path.endsWith('.d.ts');
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    return statSync(fullPath).isDirectory() ? walk(fullPath) : [fullPath];
  });
}

// Token walk instead of one big regex: `export [declare] [async] <keyword> <name>`.
function declaredExport(line: string): string | undefined {
  const tokens = line.trim().split(/\s+/);
  if (tokens[0] !== 'export') return undefined;
  let index = 1;
  while (MODIFIERS.has(tokens[index])) index += 1;
  if (!DECLARATION_KEYWORDS.has(tokens[index])) return undefined;
  return /^[A-Za-z_$][\w$]*/.exec(tokens[index + 1] ?? '')?.[0];
}

// `export { a, b as c }` → a, c. Re-exports (`… from '…'`) belong to the source module.
function listedExports(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(
    /export\s+(?:type\s+)?\{([^}]*)\}([^;\n]*)/g
  )) {
    if (match[2].includes('from')) continue;
    for (const part of match[1].split(',')) {
      const alias = part.trim().split(/\s+/).pop();
      if (alias && alias !== 'default') names.push(alias);
    }
  }
  return names;
}

function namedExports(source: string): string[] {
  const declared = source
    .split(/\r?\n/)
    .map(declaredExport)
    .filter((name): name is string => name !== undefined);
  return [...new Set([...declared, ...listedExports(source)])];
}

const files = SOURCE_DIRS.flatMap((dir) => walk(join(root, dir))).filter(
  (f) => SOURCE_EXTENSIONS.has(extname(f)) && !isTestFile(f)
);
const contents = new Map(
  files.map((file) => [file, readFileSync(file, 'utf8')])
);
const orphans: string[] = [];

for (const [file, source] of contents) {
  const stem = basename(file, extname(file));
  if (relative(root, file).startsWith('app') && APP_ROUTER_FILES.has(stem))
    continue;
  for (const name of namedExports(source)) {
    if (FRAMEWORK_EXPORTS.has(name)) continue;
    const usage = new RegExp(`\\b${name.replaceAll('$', '\\$')}\\b`);
    const used = [...contents].some(
      ([other, text]) => other !== file && usage.test(text)
    );
    if (!used) orphans.push(`${relative(root, file)} → ${name}`);
  }
}

// public/brand/x.svg is served at /brand/x.svg: a source file must name that path.
const publicFiles = walk(join(root, PUBLIC_DIR)).filter(
  (f) => !SERVER_FILES.has(basename(f))
);
for (const file of publicFiles) {
  const urlPath = `/${relative(join(root, PUBLIC_DIR), file).replaceAll('\\', '/')}`;
  const used = [...contents.values()].some((text) => text.includes(urlPath));
  if (!used) orphans.push(`${relative(root, file)} → not referenced`);
}

if (orphans.length > 0) {
  console.error(
    '[FAIL] DC4 dead code (named exports or public/ files with no consumer):'
  );
  for (const orphan of orphans) console.error(`  - ${orphan}`);
  process.exit(1);
}
console.log(
  `[OK] DC4 no dead exports across ${files.length} source file(s) and no unreferenced public/ file across ${publicFiles.length}.`
);
