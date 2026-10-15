/**
 * Gate 2 · Diff-scoped quality (FC 001).
 * For files added or modified under app/ between --base and --head:
 *   1. ESLint (eslint.config.js, SonarJS rules included) must report 0 errors.
 *   2. Added lines must not introduce console.log, debugger, NOSONAR or eslint-disable.
 * CLI: `bun scripts/checkDiffQuality.ts --base <sha> --head <sha>` — exit 0 = clean · exit 1 = violations.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { ESLint } from 'eslint';

const FORBIDDEN: ReadonlyArray<[string, RegExp]> = [
  ['console.log', /console\.log\(/],
  ['debugger', /\bdebugger\b/],
  ['NOSONAR', /NOSONAR/],
  ['eslint-disable', /eslint-disable/],
];

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (!value) {
    console.error(`[FAIL] Gate 2: missing ${name} <sha>`);
    process.exit(1);
  }
  return value;
}

function git(args: string[]): string {
  // git is resolved from PATH on purpose: the CI runner image provides it.
  // eslint-disable-next-line sonarjs/no-os-command-from-path
  return execFileSync('git', args, { encoding: 'utf8' });
}

const base = argument('--base');
const head = argument('--head');
const changed = git([
  'diff',
  '--name-only',
  '--diff-filter=AM',
  base,
  head,
  '--',
  'app',
])
  .split(/\r?\n/)
  .filter(
    (file) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file) && existsSync(file)
  );

const violations: string[] = [];

for (const file of changed) {
  const added = git(['diff', '-U0', base, head, '--', file])
    .split(/\r?\n/)
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'));
  for (const line of added) {
    for (const [label, pattern] of FORBIDDEN) {
      if (pattern.test(line))
        violations.push(`${file}: adds ${label} → ${line.slice(1).trim()}`);
    }
  }
}

if (changed.length > 0) {
  const results = await new ESLint().lintFiles(changed);
  for (const result of results) {
    for (const message of result.messages.filter((m) => m.severity === 2)) {
      violations.push(
        `${result.filePath}:${message.line} ${message.ruleId ?? 'eslint'} — ${message.message}`
      );
    }
  }
}

if (violations.length > 0) {
  console.error(
    `[FAIL] Gate 2 diff quality (${base.slice(0, 7)}..${head.slice(0, 7)}):`
  );
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}
console.log(
  `[OK] Gate 2 diff quality: ${changed.length} changed app file(s) clean (${base.slice(0, 7)}..${head.slice(0, 7)}).`
);
