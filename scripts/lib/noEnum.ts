/**
 * ADR 0007 detector: domain values never use MariaDB `ENUM(...)` or `SET(...)` column types
 * (truth table T1.4 · ScalableDomain ⟺ ¬E ∧ R; E is what this module finds).
 *
 * A small scanner blanks comments (`--`, `#`, `/* *\/`) and quoted text (`'…'`, `"…"`,
 * backticks) first, so a comment that mentions ENUM, or data such as `'SET('`, is not reported.
 * Newlines are kept, so findings carry their real line numbers.
 *
 * @module
 */

/** One ENUM/SET column type found in a SQL file. */
export interface EnumFinding {
  /** 1-based line of the type. */
  line: number;
  /** `ENUM` or `SET`, as written. */
  type: string;
}

const ENUM_OR_SET = /\b(ENUM|SET)\s*\(/gi;
const QUOTES = new Set(["'", '"', '`']);

/** Index just past the closing quote of the quoted text starting at `start`. */
function quotedEnd(sql: string, start: number): number {
  const quote = sql[start];
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === '\\') {
      i += 2;
    } else if (sql[i] === quote && sql[i + 1] === quote) {
      i += 2; // doubled quote inside the text
    } else if (sql[i] === quote) {
      return i + 1;
    } else {
      i += 1;
    }
  }
  return sql.length;
}

/** Index just past the comment or quoted text starting at `i`, or -1 if none starts there. */
function skippedEnd(sql: string, i: number): number {
  if (sql.startsWith('--', i) || sql[i] === '#') {
    const newline = sql.indexOf('\n', i);
    return newline < 0 ? sql.length : newline;
  }
  if (sql.startsWith('/*', i)) {
    const close = sql.indexOf('*/', i + 2);
    return close < 0 ? sql.length : close + 2;
  }
  return QUOTES.has(sql[i]) ? quotedEnd(sql, i) : -1;
}

/** The SQL with every comment and quoted text replaced by spaces (newlines kept). */
function codeOnly(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const end = skippedEnd(sql, i);
    if (end < 0) {
      out += sql[i];
      i += 1;
    } else {
      out += sql.slice(i, end).replaceAll(/[^\n]/g, ' ');
      i = end;
    }
  }
  return out;
}

/**
 * Finds ENUM/SET column types in SQL text.
 *
 * @param sql - Content of one migration.
 * @returns Every ENUM/SET type with its line; empty when the file complies with ADR 0007.
 */
export function findEnumTypes(sql: string): EnumFinding[] {
  const code = codeOnly(sql);
  return [...code.matchAll(ENUM_OR_SET)].map((match) => ({
    line: code.slice(0, match.index).split('\n').length,
    type: match[1],
  }));
}
