/**
 * The invoices the staff uploads (FC 077 F3): the external system stamps them, the store checks,
 * keeps and delivers them.
 *
 * - An upload is judged in a fixed order (T1.3): the PDF, the XML, the issuer, what the XML says
 *   against the request and what is left to invoice, and the folio. The request and its order are
 *   locked, so a return or a second upload cannot slip in between.
 * - Both files are kept inside the database (T0.2): the release folder of the API is replaced on
 *   every deploy. A folio is never stored twice, cancelled or not (T0.4).
 * - The mail that delivers the invoice is queued with ids only (T2.4).
 * - A request still waiting may be rejected; a completed one may be cancelled when the invoice was
 *   cancelled in the external system. Both leave room for a new request.
 *
 * Every statement is static SQL with `?` placeholders (A03).
 *
 * @module
 */
import { createHash } from 'node:crypto';
import { recordAudit } from './audit';
import { readCfdi } from './cfdiReader';
import type { Db, TxQuery } from './db';
import { invoicableCents } from './invoiceRequests';
import { enqueueMail } from './outbox';

const MAX_PDF_BYTES = 2_097_152;
const MAX_XML_BYTES = 524_288;
/** The XML total and what is left to invoice may differ by rounding up to one peso. */
const TOLERANCE_CENTS = 100;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Why an upload, a rejection or a cancellation is refused. */
type AdminRefusal =
  | 'INVOICE_REQUEST_NOT_FOUND'
  | 'INVOICE_REQUEST_NOT_PENDING'
  | 'INVOICE_REQUEST_NOT_COMPLETED'
  | 'INVALID_PDF_FILE_REJECT'
  | 'INVALID_XML_FILE_REJECT'
  | 'FISCAL_CONFIGURATION_ERROR'
  | 'INVALID_ISSUER_RFC_REJECT'
  | 'METADATA_MISMATCH_REJECT'
  | 'INVALID_OR_DUPLICATE_UUID_REJECT';

/** Status and title of each refusal. */
export const INVOICE_ADMIN_REFUSALS: Readonly<
  Record<AdminRefusal, readonly [number, string]>
> = {
  INVOICE_REQUEST_NOT_FOUND: [404, 'Not found'],
  INVOICE_REQUEST_NOT_PENDING: [409, 'The request is not waiting'],
  INVOICE_REQUEST_NOT_COMPLETED: [409, 'The request has no invoice to cancel'],
  INVALID_PDF_FILE_REJECT: [400, 'The PDF is not valid'],
  INVALID_XML_FILE_REJECT: [400, 'The XML is not a CFDI 4.0'],
  FISCAL_CONFIGURATION_ERROR: [500, 'The store has no RFC configured'],
  INVALID_ISSUER_RFC_REJECT: [400, 'The invoice was not issued by the store'],
  METADATA_MISMATCH_REJECT: [
    400,
    'The receiver or the total does not match the request',
  ],
  INVALID_OR_DUPLICATE_UUID_REJECT: [
    409,
    'The fiscal folio is missing or already registered',
  ],
};

/** Who acts, for the audit trail. */
interface Actor {
  userId: string;
  ip: string;
}

/** The bytes of a base64 field, or null when it is not base64. */
function decode(base64: string): Buffer | null {
  return base64.length % 4 === 0 && BASE64.test(base64)
    ? Buffer.from(base64, 'base64')
    : null;
}

const sha256 = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');

/** P and X of T1.3: what can be judged of the two files alone. */
function readFiles(files: { pdfBase64: string; xmlBase64: string }) {
  const pdf = decode(files.pdfBase64);
  if (
    pdf === null ||
    pdf.length > MAX_PDF_BYTES ||
    pdf.subarray(0, 5).toString('latin1') !== '%PDF-'
  ) {
    return 'INVALID_PDF_FILE_REJECT';
  }
  const xml = decode(files.xmlBase64);
  const cfdi =
    xml === null || xml.length > MAX_XML_BYTES ? null : readCfdi(xml);
  if (xml === null || cfdi === null) return 'INVALID_XML_FILE_REJECT';
  return { pdf, xml, cfdi };
}

/** The request and its order, locked. */
interface Locked {
  order_id: number;
  order_number: string;
  status: string;
  rfc: string;
  total_mxn_cents: number;
}

async function lockRequest(
  tx: TxQuery,
  id: number
): Promise<Locked | undefined> {
  const [row] = await tx.query<Locked>(
    'SELECT r.order_id, o.order_number, r.status, r.rfc, o.total_mxn_cents FROM invoice_requests r JOIN orders o ON o.id = r.order_id WHERE r.id = ? FOR UPDATE',
    [id]
  );
  return row;
}

/**
 * Takes the two files of an invoice for a request that waits, and queues their delivery.
 *
 * @param tx - Transaction of the request.
 * @param id - The request.
 * @param files - The XML and the PDF, in base64.
 * @param context - The RFC of the store (null when not configured) and who uploads.
 * @returns The request completed with its folio, or why not (T1.3).
 */
export async function uploadInvoice(
  tx: TxQuery,
  id: number,
  files: { pdfBase64: string; xmlBase64: string },
  context: { storeRfc: string | null; actor: Actor }
): Promise<{ id: number; status: 'COMPLETED'; uuid: string } | AdminRefusal> {
  const request = await lockRequest(tx, id);
  if (request === undefined) return 'INVOICE_REQUEST_NOT_FOUND';
  if (request.status !== 'PENDING') return 'INVOICE_REQUEST_NOT_PENDING';
  const read = readFiles(files);
  if (typeof read === 'string') return read;
  const { pdf, xml, cfdi } = read;
  const { storeRfc, actor } = context;
  if (storeRfc === null) return 'FISCAL_CONFIGURATION_ERROR';
  if (cfdi.issuerRfc !== storeRfc) return 'INVALID_ISSUER_RFC_REJECT';
  const left = await invoicableCents(
    tx,
    request.order_id,
    request.total_mxn_cents
  );
  if (
    cfdi.receiverRfc !== request.rfc ||
    Math.abs(cfdi.totalCents - left) > TOLERANCE_CENTS
  ) {
    return 'METADATA_MISMATCH_REJECT';
  }
  const { stamp } = cfdi;
  if (stamp === null) return 'INVALID_OR_DUPLICATE_UUID_REJECT';
  const [known] = await tx.query<{ id: number }>(
    'SELECT id FROM order_invoices WHERE uuid = ? FOR UPDATE',
    [stamp.uuid]
  );
  if (known !== undefined) return 'INVALID_OR_DUPLICATE_UUID_REJECT';

  const name = `${request.order_number}-factura`;
  await tx.query(
    'INSERT INTO order_invoices (invoice_request_id, order_id, uuid, rfc_issuer, rfc_receiver, total_cents, stamped_at, xml_filename, xml_data, xml_sha256, pdf_filename, pdf_data, pdf_sha256, uploaded_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      id,
      request.order_id,
      stamp.uuid,
      cfdi.issuerRfc,
      cfdi.receiverRfc,
      cfdi.totalCents,
      stamp.stampedAt,
      `${name}.xml`,
      xml,
      sha256(xml),
      `${name}.pdf`,
      pdf,
      sha256(pdf),
      actor.userId,
    ]
  );
  await tx.query(
    "UPDATE invoice_requests SET status = 'COMPLETED', completed_at = UTC_TIMESTAMP(), fulfilled_by_user_id = ? WHERE id = ?",
    [actor.userId, id]
  );
  await enqueueMail(tx, {
    type: 'INVOICE_DELIVERED',
    requestId: id,
    orderId: request.order_id,
  });
  await recordAudit(tx, {
    userId: actor.userId,
    action: 'INVOICE_UPLOADED',
    entityType: 'invoice_requests',
    entityId: String(id),
    before: null,
    after: { orderNumber: request.order_number, uuid: stamp.uuid },
    ip: actor.ip,
  });
  return { id, status: 'COMPLETED', uuid: stamp.uuid };
}

/**
 * Closes a request: a waiting one is rejected, or a completed one is cancelled with its invoice.
 *
 * @param tx - Transaction of the request.
 * @param id - The request.
 * @param how - The status it ends in (`to`), the reason the person will read, when (`now`: the 7
 *   days to ask again are counted from it) and who acts.
 * @returns The request closed, or why not.
 */
export async function closeInvoiceRequest(
  tx: TxQuery,
  id: number,
  how: {
    to: 'REJECTED' | 'CANCELLED';
    reason: string;
    now: Date;
    actor: Actor;
  }
): Promise<{ id: number; status: 'REJECTED' | 'CANCELLED' } | AdminRefusal> {
  const { to, reason, now, actor } = how;
  const request = await lockRequest(tx, id);
  if (request === undefined) return 'INVOICE_REQUEST_NOT_FOUND';
  if (to === 'REJECTED') {
    if (request.status !== 'PENDING') return 'INVOICE_REQUEST_NOT_PENDING';
    await tx.query(
      "UPDATE invoice_requests SET status = 'REJECTED', rejected_at = ?, rejection_reason = ? WHERE id = ?",
      [now, reason, id]
    );
  } else {
    if (request.status !== 'COMPLETED') return 'INVOICE_REQUEST_NOT_COMPLETED';
    await tx.query(
      "UPDATE order_invoices SET status = 'CANCELLED' WHERE invoice_request_id = ? AND status = 'ACTIVE'",
      [id]
    );
    await tx.query(
      "UPDATE invoice_requests SET status = 'CANCELLED', cancelled_at = ?, cancellation_reason = ?, cancelled_by_user_id = ? WHERE id = ?",
      [now, reason, actor.userId, id]
    );
  }
  await recordAudit(tx, {
    userId: actor.userId,
    action: `INVOICE_${to}`,
    entityType: 'invoice_requests',
    entityId: String(id),
    before: { status: request.status },
    after: { status: to },
    ip: actor.ip,
  });
  return { id, status: to };
}

/** One file of an invoice, as it is sent. */
interface InvoiceFile {
  filename: string;
  data: Buffer;
}

/**
 * Reads one file of the active invoice of an order.
 *
 * @param db - Database port.
 * @param orderNumber - The order.
 * @param kind - Which of the two files.
 * @param ownerId - The buyer who asks, or null for the staff.
 * @returns The file, or null when the order has no active invoice or is someone else's (A01).
 */
export async function readInvoiceFile(
  db: Db,
  orderNumber: string,
  kind: 'xml' | 'pdf',
  ownerId: string | null
): Promise<InvoiceFile | null> {
  const [row] = await db.query<InvoiceFile>(
    "SELECT IF(? = 'xml', i.xml_filename, i.pdf_filename) AS filename, IF(? = 'xml', i.xml_data, i.pdf_data) AS data FROM order_invoices i JOIN orders o ON o.id = i.order_id WHERE o.order_number = ? AND i.status = 'ACTIVE' AND (? IS NULL OR o.user_id = ?)",
    [kind, kind, orderNumber, ownerId, ownerId]
  );
  return row ?? null;
}
