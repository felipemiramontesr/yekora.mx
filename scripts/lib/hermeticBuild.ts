/**
 * Hermetic build rule (FC 035 T1.2, 259_AN): the site's fonts come from the repository, so a
 * build never depends on Google answering. No source file may import `next/font/google` or name
 * the Google Fonts hosts. scripts/checkPlatformGuards.ts applies it to app/, components/ and lib/.
 *
 * @module
 */

/** What a source file must not contain, and why. */
const FORBIDDEN: readonly [RegExp, string][] = [
  [
    /['"]next\/font\/google['"]/,
    'imports next/font/google (fonts must be local)',
  ],
  [/fonts\.(?:googleapis|gstatic)\.com/, 'names a Google Fonts host'],
];

/**
 * Finds every source file that would make the build or the page call Google Fonts.
 *
 * @param files - Source files by repository path.
 * @returns One message per offending file and rule; empty when the build is hermetic.
 */
export function remoteFontViolations(
  files: ReadonlyMap<string, string>
): string[] {
  const violations: string[] = [];
  for (const [path, source] of files) {
    if (/\.test\.tsx?$/.test(path)) continue;
    for (const [pattern, message] of FORBIDDEN) {
      if (pattern.test(source)) violations.push(`${path} ${message}`);
    }
  }
  return violations;
}
