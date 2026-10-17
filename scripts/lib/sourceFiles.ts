/**
 * Source tree conventions shared by the code-quality gates (DC4 dead exports and the TSDoc
 * coverage gate, FC 006), so both judge exactly the same files and the same framework
 * exceptions. A rule changed here changes both gates at once.
 *
 * @module
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative, sep } from 'node:path';

/** Product source roots; scripts/ and e2e/ are tooling, not product code. */
export const SOURCE_DIRS = ['app', 'components', 'lib'];

/** File extensions that hold product source. */
export const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);

/**
 * App Router convention files: Next.js wires them by file name, not by import, so their default
 * export and route segment exports are framework contracts rather than project API.
 */
export const APP_ROUTER_FILES = new Set([
  'page',
  'layout',
  'template',
  'not-found',
  'global-not-found',
  'error',
  'global-error',
  'loading',
  'default',
  'route',
]);

/** Named exports that Next.js reads from route files (metadata and segment config). */
export const FRAMEWORK_EXPORTS = new Set([
  'metadata',
  'generateMetadata',
  'generateStaticParams',
  'viewport',
  'generateViewport',
  'dynamicParams',
]);

/** Tests and declaration files are never product API. */
export function isTestFile(path: string): boolean {
  return /\.(test|spec)\.tsx?$/.test(path) || path.endsWith('.d.ts');
}

/**
 * Whether `file` is an App Router convention file (e.g. `app/(es)/page.tsx`).
 *
 * @param root - Repository root the path is relative to.
 * @param file - Absolute path of the file.
 */
export function isAppRouterFile(root: string, file: string): boolean {
  const inApp = relative(root, file).split(sep)[0] === 'app';
  return inApp && APP_ROUTER_FILES.has(basename(file, extname(file)));
}

/** Every file under `dir`, recursively; an empty list when `dir` does not exist. */
export function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    return statSync(fullPath).isDirectory() ? walk(fullPath) : [fullPath];
  });
}

/**
 * Product source files (no tests) under the source roots of `root`.
 *
 * @param root - Repository root.
 * @returns Absolute paths of the `.ts`/`.tsx` product files.
 */
export function productSourceFiles(root: string): string[] {
  return SOURCE_DIRS.flatMap((dir) => walk(join(root, dir))).filter(
    (file) => SOURCE_EXTENSIONS.has(extname(file)) && !isTestFile(file)
  );
}
