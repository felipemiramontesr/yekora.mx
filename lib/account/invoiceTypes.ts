/**
 * Asking for an invoice (FC 077 F2): what the buyer, or the staff on their behalf, sends, and what
 * the queue of the staff reads. One set of Zod schemas for the browser and the API (ADR 0008).
 *
 * The answers of a write carry no fiscal data: the API keeps what it answered to retry a request,
 * and none of it may be kept in the clear.
 *
 * @module
 */
import { z } from 'zod';
import { customerSchema } from '../checkout/checkoutTypes';
import { capitalsSchema, fiscalDataShape } from './fiscalTypes';

/** The statuses of a request: one PENDING or COMPLETED per order at a time (T0.4). */
const status = z.enum(['PENDING', 'COMPLETED', 'REJECTED', 'CANCELLED']);

const request = z.strictObject({
  ...fiscalDataShape,
  cfdiUse: capitalsSchema,
  emailForInvoice: customerSchema.shape.email,
});

/** Body of `POST /v1/account/orders/:order_number/invoice-request`. */
export const invoiceRequestSchema = request;

/** What the buyer sends to ask for an invoice. */
export type InvoiceRequestInput = z.infer<typeof invoiceRequestSchema>;

/** Body of `POST /v1/admin/invoices/requests`: the staff names the order. */
export const staffInvoiceRequestSchema = request.extend({
  orderNumber: z.string().max(20),
});

/** Answer of both requests: the request and its status, never what was sent. */
export const invoiceRequestedSchema = z.object({
  id: z.number().int(),
  status,
});

/** Answer of `GET /v1/account/orders/:order_number/invoice-request`: where the latest one stands. */
export const orderInvoiceStateSchema = z.object({
  status: status.nullable(),
  reason: z.string().nullable(),
});

/** Query of `GET /v1/admin/invoices/requests`. */
export const invoiceQueueQuery = z.strictObject({
  status: status.optional(),
  /** An order number or an RFC, exactly. */
  search: z.string().trim().toUpperCase().min(1).max(20).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

/** What the staff reads of one request: what the external system needs to stamp it. */
const queuedSchema = z.object({
  id: z.number().int(),
  orderNumber: z.string(),
  channel: z.string(),
  totalMxnCents: z.number().int(),
  invoicableMxnCents: z.number().int(),
  status,
  rfc: z.string(),
  legalName: z.string(),
  taxSystem: z.string(),
  postalCode: z.string(),
  cfdiUse: z.string(),
  email: z.string(),
  reason: z.string().nullable(),
  requestedAt: z.string(),
});

/** One page of the queue. */
export const invoiceQueueSchema = z.object({
  items: z.array(queuedSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

/** One page of the queue of requests. */
export type InvoiceQueue = z.infer<typeof invoiceQueueSchema>;

/** Path parameter of the routes of one request. */
export const invoiceParams = z.strictObject({
  id: z.coerce.number().int().min(1),
});

/** Body of `POST /v1/admin/invoices/requests/:id/upload`: both files in base64. */
export const invoiceUploadRequestSchema = z.strictObject({
  xmlBase64: z.string().min(1),
  pdfBase64: z.string().min(1),
});

/** Answer of an upload: the request completed and its fiscal folio. */
export const invoiceUploadedSchema = z.object({
  id: z.number().int(),
  status,
  uuid: z.string(),
});

/** Body of a rejection or a cancellation: why, as the person will read it. */
export const invoiceCloseRequestSchema = z.strictObject({
  reason: z.string().trim().min(10).max(255),
});

/** Answer of a rejection or a cancellation. */
export const invoiceClosedSchema = z.object({
  id: z.number().int(),
  status,
});
