/**
 * Client of the invoicing screens (FC 077 F4): the fiscal profile, the requests of the buyer and of
 * the staff, the queue, the upload and the closing of a request. The API decides every rule; this
 * client only carries the request and names a refusal by its machine code (the problem's `detail`).
 *
 * Every write sends a fresh `Idempotency-Key`, so a double click never files or uploads twice. Like
 * the other clients it never throws. The files of an invoice are downloaded by plain links
 * ({@link invoiceFileUrl}): the session cookie travels with them.
 *
 * @module
 */
import type { z } from 'zod';
import {
  type fiscalProfileRequestSchema,
  fiscalProfileSavedSchema,
  fiscalProfileSchema,
} from '@/lib/account/fiscalTypes';
import {
  invoiceClosedSchema,
  type InvoiceRequestInput,
  invoiceQueueSchema,
  invoiceRequestedSchema,
  invoiceUploadedSchema,
  orderInvoiceStateSchema,
} from '@/lib/account/invoiceTypes';
import { API_URL, sessionRequest, type TransportFailure } from './http';

/** The two files travel in the upload; Hostinger may also wake the API from sleep. */
const TIMEOUT_MS = 60_000;

/** Refusals the screens explain by name. */
const CODES = [
  'FISCAL_PROFILE_NOT_FOUND',
  'INVALID_RFC_REJECT',
  'INVALID_LEGAL_NAME_REJECT',
  'INVALID_TAX_SYSTEM_REJECT',
  'INVALID_POSTAL_CODE_REJECT',
  'INVALID_CFDI_USE_REJECT',
  'ORDER_NOT_FOUND',
  'ORDER_BELONGS_TO_ACCOUNT_REJECT',
  'ORDER_NOT_ELIGIBLE_REJECT',
  'FISCAL_DEADLINE_EXPIRED_REJECT',
  'INVOICE_ALREADY_EXISTS_REJECT',
  'INVOICE_REQUEST_NOT_FOUND',
  'INVOICE_REQUEST_NOT_PENDING',
  'INVOICE_REQUEST_NOT_COMPLETED',
  'INVALID_PDF_FILE_REJECT',
  'INVALID_XML_FILE_REJECT',
  'FISCAL_CONFIGURATION_ERROR',
  'INVALID_ISSUER_RFC_REJECT',
  'METADATA_MISMATCH_REJECT',
  'INVALID_OR_DUPLICATE_UUID_REJECT',
  'INVALID_REQUEST',
  'SERVICE_UNAVAILABLE',
  'PERMISSION_DENIED',
  'SECOND_FACTOR_REQUIRED',
  'SESSION_INVALID_OR_EXPIRED',
] as const;

/** Why a request gave no usable answer. */
export type InvoiceFailure =
  (typeof CODES)[number] | 'rate_limited' | 'unknown' | TransportFailure;

/** The refusal of an answer, by its machine code or its status. */
function refusal(status: number, body: unknown): InvoiceFailure {
  if (status === 429) return 'rate_limited';
  const detail = (body as { detail?: unknown } | undefined)?.detail;
  return CODES.find((code) => code === detail) ?? 'unknown';
}

/** One request with the session cookie; a write carries a new Idempotency-Key. */
function request<T>(
  path: string,
  schema: z.ZodType<T>,
  write: { method: 'POST' | 'PUT'; body: object } | null,
  fetchImpl: typeof fetch
) {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (write !== null) {
    headers['Content-Type'] = 'application/json';
    headers['Idempotency-Key'] = crypto.randomUUID();
  }
  return sessionRequest(
    fetchImpl,
    path,
    { method: write?.method ?? 'GET', headers, body: write?.body },
    TIMEOUT_MS,
    schema,
    refusal
  );
}

const QUEUE = '/v1/admin/invoices/requests';
const ownRequest = (orderNumber: string) =>
  `/v1/account/orders/${orderNumber}/invoice-request`;

/**
 * Reads the account's saved fiscal data.
 *
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The profile, or why there is none (FISCAL_PROFILE_NOT_FOUND when never saved).
 */
export function readFiscalProfile(fetchImpl: typeof fetch = fetch) {
  return request(
    '/v1/account/fiscal-profile',
    fiscalProfileSchema,
    null,
    fetchImpl
  );
}

/**
 * Saves the account's fiscal data.
 *
 * @param body - The five values.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns Whether it was saved.
 */
export function saveFiscalProfile(
  body: z.input<typeof fiscalProfileRequestSchema>,
  fetchImpl: typeof fetch = fetch
) {
  return request(
    '/v1/account/fiscal-profile',
    fiscalProfileSavedSchema,
    { method: 'PUT', body },
    fetchImpl
  );
}

/**
 * Where the latest invoice request of one of the buyer's orders stands.
 *
 * @param orderNumber - The order.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns Its status and reason.
 */
export function readInvoiceState(
  orderNumber: string,
  fetchImpl: typeof fetch = fetch
) {
  return request(
    ownRequest(orderNumber),
    orderInvoiceStateSchema,
    null,
    fetchImpl
  );
}

/**
 * Asks for the invoice of one of the buyer's orders.
 *
 * @param orderNumber - The order.
 * @param body - Fiscal data and where to send the invoice.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The request filed, or why not.
 */
export function askForInvoice(
  orderNumber: string,
  body: InvoiceRequestInput,
  fetchImpl: typeof fetch = fetch
) {
  return request(
    ownRequest(orderNumber),
    invoiceRequestedSchema,
    { method: 'POST', body },
    fetchImpl
  );
}

/**
 * The staff asks for the invoice of an order without an account.
 *
 * @param body - The order, the fiscal data and the e-mail.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The request filed, or why not.
 */
export function askForBuyer(
  body: InvoiceRequestInput & { orderNumber: string },
  fetchImpl: typeof fetch = fetch
) {
  return request(
    QUEUE,
    invoiceRequestedSchema,
    { method: 'POST', body },
    fetchImpl
  );
}

/**
 * One page of the queue.
 *
 * @param filter - Status and order number or RFC (empty for any), and the page.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The page, or why not.
 */
export function listInvoiceQueue(
  filter: { status: string; search: string; page: number },
  fetchImpl: typeof fetch = fetch
) {
  const query = new URLSearchParams({ page: String(filter.page) });
  if (filter.status !== '') query.set('status', filter.status);
  if (filter.search !== '') query.set('search', filter.search);
  return request(
    `${QUEUE}?${query.toString()}`,
    invoiceQueueSchema,
    null,
    fetchImpl
  );
}

/**
 * Uploads the XML and the PDF of a waiting request.
 *
 * @param id - The request.
 * @param files - Both files in base64.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The request completed with its folio, or why not.
 */
export function uploadInvoiceFiles(
  id: number,
  files: { xmlBase64: string; pdfBase64: string },
  fetchImpl: typeof fetch = fetch
) {
  return request(
    `${QUEUE}/${id}/upload`,
    invoiceUploadedSchema,
    { method: 'POST', body: files },
    fetchImpl
  );
}

/**
 * Rejects a waiting request, or cancels a completed one.
 *
 * @param id - The request.
 * @param action - Which of the two.
 * @param reason - Why, at least 10 characters.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The request closed, or why not.
 */
export function closeRequest(
  id: number,
  action: 'reject' | 'cancel',
  reason: string,
  fetchImpl: typeof fetch = fetch
) {
  return request(
    `${QUEUE}/${id}/${action}`,
    invoiceClosedSchema,
    { method: 'POST', body: { reason } },
    fetchImpl
  );
}

/**
 * Address of one file of an invoice, for a link.
 *
 * @param orderNumber - The order.
 * @param kind - Which file.
 * @param reader - The buyer of the order, or the staff.
 * @returns The absolute URL.
 */
export function invoiceFileUrl(
  orderNumber: string,
  kind: 'xml' | 'pdf',
  reader: 'buyer' | 'staff'
): string {
  return reader === 'buyer'
    ? `${API_URL}/v1/account/orders/${orderNumber}/invoice/${kind}`
    : `${API_URL}/v1/admin/invoices/${orderNumber}/download/${kind}`;
}
