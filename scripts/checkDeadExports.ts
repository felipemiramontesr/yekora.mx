/**
 * DC4 · Dead exports guard (FC 001), adapted to the Next.js App Router.
 * Scans named exports in app/, components/ and lib/ and fails when one is not referenced
 * by any other non-test source file.
 * Whitelist: App Router convention files (page, layout, route, …) are wired by the framework,
 * not by imports, and so are the route segment exports listed in FRAMEWORK_EXPORTS. Both lists
 * live in scripts/lib/sourceFiles.ts, shared with the TSDoc gate (FC 006).
 * FC 008: the scripts that `bun run build` runs (package.json "build", e.g. the catalog snapshot)
 * are part of the product build, so they count as consumers. They are not scanned themselves,
 * and no other script counts.
 * FC 003 F2: also fails when a file in public/ is not referenced by its URL path from any
 * non-test source file, since everything in public/ is published to yekora.mx. Server
 * configuration files (SERVER_FILES) are read by Apache, not by the site.
 * CLI: `bun scripts/checkDeadExports.ts` — exit 0 = no dead exports · exit 1 = orphans found.
 */
import { readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import {
  FRAMEWORK_EXPORTS,
  isAppRouterFile,
  productSourceFiles,
  walk,
} from './lib/sourceFiles';

const root = process.cwd();
const PUBLIC_DIR = 'public';
const SERVER_FILES = new Set(['.htaccess']);

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

const files = productSourceFiles(root);
const contents = new Map(
  files.map((file) => [file, readFileSync(file, 'utf8')])
);
const buildScript: string =
  JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts?.build ??
  '';
const buildEntries = [
  ...buildScript.matchAll(/\bbun (scripts\/\S+\.ts)\b/g),
].map(([, script]) => join(root, script));
// Sources plus build entry points: everything an export or a public/ file may be used by.
const consumers = new Map([
  ...contents,
  ...buildEntries.map((file) => [file, readFileSync(file, 'utf8')] as const),
]);
const orphans: string[] = [];

for (const [file, source] of contents) {
  if (isAppRouterFile(root, file)) continue;
  for (const name of namedExports(source)) {
    if (FRAMEWORK_EXPORTS.has(name)) continue;
    const usage = new RegExp(`\\b${name.replaceAll('$', '\\$')}\\b`);
    const used = [...consumers].some(
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
  const used = [...consumers.values()].some((text) => text.includes(urlPath));
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
  `[OK] DC4 no dead exports across ${files.length} source file(s) (+${buildEntries.length} build script(s) as consumers) and no unreferenced public/ file across ${publicFiles.length}.`
);
