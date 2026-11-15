/**
 * Guided form field rules (FC 050 T1.2, truth table: CiGuidedFieldGatePassed ⟺ F ∧ D ∧ S).
 *
 * - F: every `<input>`, `<select>` and `<textarea>` of a component draws from the `control` that
 *   `components/ui/Field.tsx` hands out (a `{...control}` spread), so its label, its hint with the
 *   simplest example and its error are tied to it. The exceptions are the controls that are not
 *   typed text: `checkbox`, `radio`, `range` and `search` inputs (the search box of the header is
 *   one), and the files of the {@link ALLOWLIST}.
 * - D: no other component named `Field` is declared: `components/ui/Field.tsx` is the only one.
 * - S: every file of the {@link ALLOWLIST} still holds a control that needs it, so the list never
 *   keeps a name that has stopped being true.
 *
 * Pure functions over source text, parsed with the TypeScript compiler API already in the repo,
 * so the rules are unit-tested without touching the file system.
 *
 * @module
 */
import ts from 'typescript';

/** Where the one guided field component lives. */
export const FIELD_MODULE = 'components/ui/Field.tsx';

/**
 * The components whose controls are not form fields to fill in, audited by hand: the filter bar of
 * the catalog, the status filter of the orders, the quantity of a cart line and the state picker
 * of the cart summary. They sit beside the thing they change, not in a form.
 */
export const ALLOWLIST: readonly string[] = [
  'components/catalog/CatalogGrid.tsx',
  'components/account/AccountOrders.tsx',
  'components/cart/CartItemRow.tsx',
  'components/cart/CartSummary.tsx',
];

/** Input types that are not typed text. */
const UNGUIDED_INPUT_TYPES = new Set(['checkbox', 'radio', 'range', 'search']);

/** What the gate found wrong in one module. */
export interface GuidedFieldFinding {
  /** Which rule failed: the control, or the second `Field`. */
  code: 'UNGUIDED_FORM_CONTROL' | 'DUPLICATE_FIELD_DEFINITION';
  /** 1-based line. */
  line: number;
  /** The element or declaration at fault. */
  name: string;
}

/** Result of checking one module. */
export interface GuidedFieldReport {
  /** Form controls the gate looked at (the exempt ones included). */
  controls: number;
  /** Controls that would fail F were the module not in the allowlist. */
  unguided: GuidedFieldFinding[];
  /** Components named `Field` declared here. */
  duplicates: GuidedFieldFinding[];
}

/** The literal text of an attribute that is a plain string, or undefined. */
function literalOf(attribute: ts.JsxAttribute): string | undefined {
  const { initializer } = attribute;
  return initializer && ts.isStringLiteral(initializer)
    ? initializer.text
    : undefined;
}

/** Whether a control is not typed text, so no `Field` is owed. */
function isExempt(tag: string, attributes: ts.JsxAttributes): boolean {
  const named = new Map<string, string | undefined>();
  for (const attribute of attributes.properties) {
    if (ts.isJsxAttribute(attribute))
      named.set(attribute.name.getText(), literalOf(attribute));
  }
  const type = named.get('type');
  return (
    tag === 'input' && type !== undefined && UNGUIDED_INPUT_TYPES.has(type)
  );
}

/** Whether the control spreads the `control` of a `Field`. */
function spreadsControl(attributes: ts.JsxAttributes): boolean {
  return attributes.properties.some(
    (attribute) =>
      ts.isJsxSpreadAttribute(attribute) &&
      ts.isIdentifier(attribute.expression) &&
      attribute.expression.text === 'control'
  );
}

/**
 * Looks at the form controls and the `Field` declarations of one module.
 *
 * @param file - Path of the module (for the parser only).
 * @param source - Its text.
 * @returns What the module holds, and what would fail F and D.
 */
export function checkGuidedFields(
  file: string,
  source: string
): GuidedFieldReport {
  const tree = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const report: GuidedFieldReport = {
    controls: 0,
    unguided: [],
    duplicates: [],
  };
  const lineOf = (node: ts.Node) =>
    tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;

  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(tree);
      if (tag === 'input' || tag === 'select' || tag === 'textarea') {
        report.controls += 1;
        if (!isExempt(tag, node.attributes) && !spreadsControl(node.attributes))
          report.unguided.push({
            code: 'UNGUIDED_FORM_CONTROL',
            line: lineOf(node),
            name: tag,
          });
      }
    }
    const declared =
      (ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isVariableDeclaration(node)) &&
      node.name !== undefined &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'Field';
    if (declared)
      report.duplicates.push({
        code: 'DUPLICATE_FIELD_DEFINITION',
        line: lineOf(node),
        name: 'Field',
      });
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return report;
}

/**
 * The entries of an allowlist that no longer name a module with an unguided control: the list
 * must stay exactly as long as the exceptions it excuses (S).
 *
 * @param allowlist - The audited modules.
 * @param unguidedBy - How many unguided controls each module has, by path.
 * @returns The stale entries, in order.
 */
export function staleEntries(
  allowlist: readonly string[],
  unguidedBy: ReadonlyMap<string, number>
): string[] {
  return allowlist.filter((entry) => (unguidedBy.get(entry) ?? 0) === 0);
}
