/**
 * TSDoc coverage rules (FC 006, truth table T1.1: GatePass ⟺ T ∧ C).
 *
 * - T: every exported declaration of a product module carries a doc block (`/** … *\/`).
 * - C: that block is not empty and its tags are well formed: only known TSDoc tags, every tag
 *   that needs text has text, and each `@param` names a real parameter (or a property
 *   destructured from one, the usual shape of React props).
 *
 * Pure functions over source text, parsed with the TypeScript compiler API already in the
 * repo (no extra dependency), so the rules are unit-tested without touching the file system.
 *
 * @module
 */
import ts from 'typescript';

/** A missing or malformed doc block on an export. */
export interface TsDocFinding {
  /** Exported name, or `default` for an anonymous default export. */
  name: string;
  /** 1-based line of the declaration. */
  line: number;
  /** Why the export fails the gate. */
  reason: string;
}

/** Result of checking one module. */
export interface TsDocReport {
  /** Exported declarations the gate looked at. */
  checked: number;
  /** Exports that fail T or C. */
  findings: TsDocFinding[];
}

/** Options that shape which exports of a module are project API. */
export interface TsDocOptions {
  /** App Router convention file: its default export belongs to the framework. */
  frameworkFile?: boolean;
  /** Named exports read by the framework (e.g. `metadata`), never project API. */
  frameworkExports?: ReadonlySet<string>;
}

const KNOWN_TAGS = new Set([
  'param',
  'returns',
  'remarks',
  'example',
  'see',
  'deprecated',
  'defaultValue',
  'throws',
  'typeParam',
  'privateRemarks',
  'internal',
]);
const TAGS_WITH_TEXT = new Set(['param', 'returns', 'remarks', 'throws']);

type Exported =
  | ts.FunctionDeclaration
  | ts.ClassDeclaration
  | ts.InterfaceDeclaration
  | ts.TypeAliasDeclaration
  | ts.EnumDeclaration
  | ts.VariableStatement;

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind)
  );
}

function isExportedDeclaration(node: ts.Node): node is Exported {
  return (
    (ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isVariableStatement(node)) &&
    hasModifier(node, ts.SyntaxKind.ExportKeyword)
  );
}

function exportedNames(node: Exported): string[] {
  if (ts.isVariableStatement(node)) {
    return node.declarationList.declarations.map((d) => d.name.getText());
  }
  if (hasModifier(node, ts.SyntaxKind.DefaultKeyword)) return ['default'];
  return [node.name?.getText() ?? 'default'];
}

/** Names a `@param` tag may document: parameters and props destructured from them. */
function parameterNames(node: Exported): Set<string> {
  const names = new Set<string>();
  const fn = ts.isVariableStatement(node)
    ? node.declarationList.declarations[0]?.initializer
    : node;
  if (
    !fn ||
    !(
      ts.isFunctionDeclaration(fn) ||
      ts.isArrowFunction(fn) ||
      ts.isFunctionExpression(fn)
    )
  ) {
    return names;
  }
  for (const parameter of fn.parameters) {
    if (ts.isIdentifier(parameter.name)) names.add(parameter.name.text);
    if (ts.isObjectBindingPattern(parameter.name)) {
      for (const element of parameter.name.elements) {
        names.add(element.name.getText());
      }
    }
  }
  return names;
}

function tagText(tag: ts.JSDocTag): string {
  return (ts.getTextOfJSDocComment(tag.comment) ?? '')
    .replace(/^-\s*/, '')
    .trim();
}

/** Why the doc block of `node` fails T or C, or `undefined` when it passes. */
function docProblem(node: Exported): string | undefined {
  const docs = (ts.getJSDocCommentsAndTags(node) ?? []).filter(ts.isJSDoc);
  const doc = docs.at(-1);
  if (!doc) return 'missing TSDoc block';
  const summary = (ts.getTextOfJSDocComment(doc.comment) ?? '').trim();
  const tags = doc.tags ?? [];
  if (!summary && tags.length === 0) return 'empty TSDoc block';
  if (!summary) return 'TSDoc block has tags but no summary';
  const params = parameterNames(node);
  for (const tag of tags) {
    const name = tag.tagName.text;
    if (!KNOWN_TAGS.has(name)) return `unknown tag @${name}`;
    if (TAGS_WITH_TEXT.has(name) && !tagText(tag)) {
      return `@${name} without text`;
    }
    if (ts.isJSDocParameterTag(tag) && !params.has(tag.name.getText())) {
      return `@param ${tag.name.getText()} does not match a parameter`;
    }
  }
  return undefined;
}

/**
 * Checks every exported declaration of one module against the TSDoc rules.
 *
 * @param fileName - Used only to pick the parser flavour (`.tsx` enables JSX).
 * @param source - Module source text.
 * @param options - Framework exceptions for App Router files.
 * @returns How many exports were checked and which ones fail.
 */
export function checkTsDoc(
  fileName: string,
  source: string,
  options: TsDocOptions = {}
): TsDocReport {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const report: TsDocReport = { checked: 0, findings: [] };
  for (const statement of file.statements) {
    if (!isExportedDeclaration(statement)) continue;
    const names = exportedNames(statement).filter(
      (name) =>
        !options.frameworkExports?.has(name) &&
        !(options.frameworkFile && name === 'default')
    );
    if (names.length === 0) continue;
    report.checked += names.length;
    const problem = docProblem(statement);
    if (problem) {
      const { line } = file.getLineAndCharacterOfPosition(statement.getStart());
      for (const name of names) {
        report.findings.push({ name, line: line + 1, reason: problem });
      }
    }
  }
  return report;
}
