/**
 * SQL-injection guard rules (FC 008, OWASP A03, truth table T1.1 · SafeQuery ⟺ L ∧ P ∧ C).
 *
 * L: the first argument of every `.query(...)` / `.execute(...)` call is a static string
 * (a plain literal or a template without `${}`). Anything else is reported, whether it is a
 * variable, a concatenation or an interpolated template: values must travel in the parameter
 * array (P). The TypeScript compiler API parses the code, so comments and strings never confuse
 * it. Pure functions: scripts/checkNoRawSql.ts applies them to apps/api/src.
 *
 * Exceptions follow Archon's model (audited allowlist, changed only through a signed FC), but
 * per call instead of per line or file: each entry exempts exactly one call, and an entry that
 * no longer matches anything fails the guard too, so the list can never go stale.
 *
 * @module
 */
import ts from 'typescript';

/** One query call whose SQL is not a static string. */
export interface RawSqlFinding {
  /** 1-based line of the call. */
  line: number;
  /** The SQL argument as written, shortened. */
  argument: string;
}

const QUERY_METHODS = new Set(['query', 'execute']);

/**
 * Finds query calls whose SQL text is not static.
 *
 * @param fileName - Used only to pick the parser flavour.
 * @param source - Module source text.
 * @returns Every non-static SQL argument with its line; empty when the module is safe.
 */
export function findRawSql(fileName: string, source: string): RawSqlFinding[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true
  );
  const findings: RawSqlFinding[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      QUERY_METHODS.has(node.expression.name.text)
    ) {
      const [sql] = node.arguments;
      const isStatic =
        sql !== undefined &&
        (ts.isStringLiteral(sql) || ts.isNoSubstitutionTemplateLiteral(sql));
      if (!isStatic) {
        const { line } = file.getLineAndCharacterOfPosition(node.getStart());
        findings.push({
          line: line + 1,
          argument: (sql?.getText() ?? '(none)').slice(0, 60),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return findings;
}

/** One audited exception: a single non-static query call, with the reason it is safe. */
export interface AllowlistEntry {
  /** Repo-relative path with forward slashes. */
  file: string;
  /** The SQL argument exactly as {@link findRawSql} reports it. */
  argument: string;
  /** Why this call cannot inject (and which FC approved it). */
  reason: string;
}

/**
 * Audited exceptions. Adding or removing an entry requires a signed FC (same rule as Archon).
 */
export const ALLOWLIST: readonly AllowlistEntry[] = [
  {
    file: 'apps/api/src/services/db.ts',
    argument: 'sql',
    reason:
      'FC 008 F2 — Db.query adapter: forwards to the mysql2 pool the SQL its callers pass, and every caller is checked by this guard; values stay in the params array.',
  },
  {
    file: 'apps/api/src/services/db.ts',
    argument: 'sql',
    reason:
      'FC 012 F2 — transaction adapter: the same forwarding as Db.query, on the connection that holds the transaction; its callers are checked by this guard too.',
  },
];

/**
 * Applies the allowlist to the findings of every scanned file.
 *
 * @param findings - Findings per repo-relative path (forward slashes).
 * @param allowlist - Audited exceptions; each one exempts at most one call.
 * @returns The findings still unexempted (`path:line argument`) and the entries that matched
 *   nothing; the guard passes only when both are empty.
 */
export function applyAllowlist(
  findings: ReadonlyMap<string, readonly RawSqlFinding[]>,
  allowlist: readonly AllowlistEntry[]
): { violations: string[]; staleEntries: AllowlistEntry[] } {
  const pending = [...allowlist];
  const violations: string[] = [];
  for (const [file, fileFindings] of findings) {
    for (const finding of fileFindings) {
      const match = pending.findIndex(
        (entry) => entry.file === file && entry.argument === finding.argument
      );
      if (match === -1)
        violations.push(`${file}:${finding.line} ${finding.argument}`);
      else pending.splice(match, 1);
    }
  }
  return { violations, staleEntries: pending };
}
