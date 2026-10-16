/**
 * DC4 · Dead exports guard (FC 001), adapted to the Next.js App Router.
 * Scans named exports in app/, components/ and lib/ and fails when one is not referenced
 * by any other non-test source file.
 * Whitelist: App Router convention files (page, layout, route, …) are wired by the framework,
 * not by imports, and so are the route segment exports listed in FRAMEWORK_EXPORTS.
 * CLI: `bun scripts/checkDeadExports.ts` — exit 0 = no dead exports · exit 1 = orphans found.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';

const root = process.cwd();
const SOURCE_DIRS = ['app', 'components', 'lib'];
// Root files Next.js loads by convention: they consume exports but their own exports are framework entry points.
const ROOT_CONSUMERS = ['middleware.ts'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);
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
    if (statSync(fullPath).isDirectory()) return walk(fullPath);
    return SOURCE_EXTENSIONS.has(extname(entry)) ? [fullPath] : [];
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
  (f) => !isTestFile(f)
);
const contents = new Map(
  files.map((file) => [file, readFileSync(file, 'utf8')])
);
const consumers = new Map(contents);
for (const file of ROOT_CONSUMERS.map((name) => join(root, name))) {
  if (existsSync(file)) consumers.set(file, readFileSync(file, 'utf8'));
}
const orphans: string[] = [];

for (const [file, source] of contents) {
  const stem = basename(file, extname(file));
  if (relative(root, file).startsWith('app') && APP_ROUTER_FILES.has(stem))
    continue;
  for (const name of namedExports(source)) {
    if (FRAMEWORK_EXPORTS.has(name)) continue;
    const usage = new RegExp(`\\b${name.replaceAll('$', '\\$')}\\b`);
    const used = [...consumers].some(
      ([other, text]) => other !== file && usage.test(text)
    );
    if (!used) orphans.push(`${relative(root, file)} → ${name}`);
  }
}

if (orphans.length > 0) {
  console.error('[FAIL] DC4 dead exports (named exports with no consumer):');
  for (const orphan of orphans) console.error(`  - ${orphan}`);
  process.exit(1);
}
console.log(`[OK] DC4 no dead exports across ${files.length} source file(s).`);
