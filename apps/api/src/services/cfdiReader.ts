/**
 * Reads what the store checks of a CFDI 4.0 XML (FC 077 F3, T0.3, T1.3).
 *
 * - A document with `<!DOCTYPE` or `<!ENTITY` is refused before any parsing, so no external or
 *   expanding entity is ever read (XXE, SSRF).
 * - The elements are found by namespace URI and local name, never by prefix: an issuer may name
 *   the SAT namespaces as it likes.
 * - Only the attributes the gate judges are read. The store does not verify the SAT's seal: the
 *   invoice comes from the shop's own external system, uploaded by staff.
 *
 * @module
 */
import { XMLParser, XMLValidator } from 'fast-xml-parser';

// XML namespace names, not addresses anything connects to: the SAT publishes them with http, and
// a document that names them otherwise is not a CFDI.
// eslint-disable-next-line sonarjs/no-clear-text-protocols
const CFDI = 'http://www.sat.gob.mx/cfd/4'; // NOSONAR
// eslint-disable-next-line sonarjs/no-clear-text-protocols
const STAMP = 'http://www.sat.gob.mx/TimbreFiscalDigital'; // NOSONAR

const UUID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;
const STAMPED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
const AMOUNT = /^\d{1,12}(\.\d{1,6})?$/;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  parseAttributeValue: false,
  parseTagValue: false,
});

/** The folio of a stamp and when it was given. */
interface Stamp {
  uuid: string;
  /** `YYYY-MM-DD HH:MM:SS`, as the XML says it (the SAT gives local time with no zone). */
  stampedAt: string;
}

/** What the gate T1.3 reads of one invoice. */
interface CfdiSummary {
  /** `Emisor/@Rfc`, or an empty string. */
  issuerRfc: string;
  /** `Receptor/@Rfc`, or an empty string. */
  receiverRfc: string;
  /** `Comprobante/@Total` in cents. */
  totalCents: number;
  /** The stamp, or null when there is none of version 1.1 with a well-formed folio. */
  stamp: Stamp | null;
}

type Node = Record<string, unknown>;

/** One element with the namespaces in force on it. */
interface Element {
  uri: string;
  name: string;
  node: Node;
  scope: ReadonlyMap<string, string>;
}

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null;

/** The namespaces in force on a node: those around it plus the ones it declares. */
function scopeOf(
  node: Node,
  outer: ReadonlyMap<string, string>
): ReadonlyMap<string, string> {
  const scope = new Map(outer);
  for (const [key, value] of Object.entries(node)) {
    if (key === '@xmlns') scope.set('', String(value));
    else if (key.startsWith('@xmlns:')) scope.set(key.slice(7), String(value));
  }
  return scope;
}

/** The elements directly inside a node. */
function children(node: Node, outer: ReadonlyMap<string, string>): Element[] {
  return Object.entries(node)
    .filter(([key]) => !key.startsWith('@') && !key.startsWith('?'))
    .flatMap(([key, value]) =>
      [value].flat().map((child) => {
        const inner = isNode(child) ? child : {};
        const scope = scopeOf(inner, outer);
        const colon = key.indexOf(':');
        const prefix = colon === -1 ? '' : key.slice(0, colon);
        return {
          uri: scope.get(prefix) ?? '',
          name: key.slice(colon + 1),
          node: inner,
          scope,
        };
      })
    );
}

const find = (inside: Element, uri: string, name: string) =>
  children(inside.node, inside.scope).find(
    (child) => child.uri === uri && child.name === name
  );

const attribute = (element: Element | undefined, name: string): string => {
  const value = element?.node[`@${name}`];
  return typeof value === 'string' ? value.trim() : '';
};

/** The stamp of a `Complemento`, wherever among its complements it is. */
function stampOf(comprobante: Element): Stamp | null {
  const stamp = children(comprobante.node, comprobante.scope)
    .filter((child) => child.uri === CFDI && child.name === 'Complemento')
    .map((complement) => find(complement, STAMP, 'TimbreFiscalDigital'))
    .find((found) => found !== undefined);
  const uuid = attribute(stamp, 'UUID').toUpperCase();
  const at = attribute(stamp, 'FechaTimbrado');
  if (
    attribute(stamp, 'Version') !== '1.1' ||
    !UUID.test(uuid) ||
    !STAMPED_AT.test(at)
  ) {
    return null;
  }
  return { uuid, stampedAt: at.replace('T', ' ') };
}

/**
 * Reads a CFDI 4.0.
 *
 * @param bytes - The XML file, UTF-8 with or without a byte order mark.
 * @returns What the gate judges, or null when the file is not a well-formed CFDI 4.0, declares a
 *   document type or an entity, or is not valid UTF-8.
 */
export function readCfdi(bytes: Buffer): CfdiSummary | null {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  if (/<!(DOCTYPE|ENTITY)/i.test(text)) return null;
  if (XMLValidator.validate(text) !== true) return null;
  const document: Element = {
    uri: '',
    name: '',
    node: parser.parse(text) as Node,
    scope: new Map(),
  };
  const comprobante = find(document, CFDI, 'Comprobante');
  const total = attribute(comprobante, 'Total');
  if (
    comprobante === undefined ||
    attribute(comprobante, 'Version') !== '4.0' ||
    !AMOUNT.test(total)
  ) {
    return null;
  }
  return {
    issuerRfc: attribute(find(comprobante, CFDI, 'Emisor'), 'Rfc'),
    receiverRfc: attribute(find(comprobante, CFDI, 'Receptor'), 'Rfc'),
    totalCents: Math.round(Number(total) * 100),
    stamp: stampOf(comprobante),
  };
}
