/**
 * Contract of the returns (FC 071, K-80): what the buyer sends to ask for a return, what the
 * panel's board lists, and what an operator sends to prepare and confirm the refund. Zod only, so
 * the browser can share it (ADR 0008). No personal data travels here: a request names the order,
 * the SKUs and the units, and the board shows the order number, never the buyer.
 *
 * @module
 */
import { z } from 'zod';

/** Why the buyer returns what they bought. */
const RETURN_REASONS = ['DEFECT', 'NOT_AS_DESCRIBED', 'CHANGED_MIND'] as const;

/** The stages of a request: asked, prepared by an operator, being refunded, refunded. */
const RETURN_STATUSES = [
  'REQUESTED',
  'PREPARED',
  'REFUNDING',
  'REFUNDED',
] as const;

/** One line of a request: a SKU of the order and how many units come back. */
const returnLineSchema = z.strictObject({
  sku: z.string().min(1).max(64),
  quantity: z.number().int().min(1).max(99),
});

/** What the buyer sends to ask for a return (`POST /v1/account/orders/:order_number/returns`). */
export const returnRequestSchema = z.strictObject({
  items: z.array(returnLineSchema).min(1).max(50),
  reason: z.enum(RETURN_REASONS),
  comment: z.string().trim().max(500).optional(),
});

/** What the buyer sends to ask for a return, as a type. */
export type ReturnRequest = z.infer<typeof returnRequestSchema>;

/** One request of the board and the answer of every returns route. */
export const returnSchema = z.strictObject({
  id: z.number().int().positive(),
  orderNumber: z.string(),
  status: z.enum(RETURN_STATUSES),
  reason: z.enum(RETURN_REASONS),
  comment: z.string().nullable(),
  items: z.array(returnLineSchema),
  refundMxnCents: z.number().int().positive().nullable(),
  restock: z.boolean().nullable(),
  createdAt: z.string(),
  preparedAt: z.string().nullable(),
  confirmedAt: z.string().nullable(),
  /** True for the return of a counter sale, paid back in cash or on the terminal (FC 076). */
  counter: z.boolean(),
});

/** One request of the board, as a type. */
export type ReturnView = z.infer<typeof returnSchema>;

/** The board: every request, newest first, with the total of the filter. */
export const returnListSchema = z.strictObject({
  items: z.array(returnSchema),
  total: z.number().int().min(0),
});

/** The filter of the board. */
export const returnListQuery = z.strictObject({
  status: z.enum(RETURN_STATUSES).optional(),
});

/** What an operator sets when preparing: the amount to refund and whether the units go back. */
export const returnPrepareRequestSchema = z.strictObject({
  refundMxnCents: z.number().int().min(1).max(100_000_000),
  restock: z.boolean(),
});

/** What the confirmer sends; a refund made by hand at Mercado Pago names its reference. */
export const returnConfirmRequestSchema = z.strictObject({
  manualReference: z.string().trim().min(1).max(128).optional(),
  /** How a counter sale is paid back (FC 076): cash from the drawer or the terminal. */
  refundMethod: z.enum(['CASH', 'TERMINAL']).optional(),
});

/** Path parameter of one request. */
export const returnParams = z.strictObject({
  id: z.coerce.number().int().positive(),
});

/** What the staff of the counter sends to ask for the return of a counter sale (FC 076 F3). */
export const posReturnRequestSchema = returnRequestSchema.extend({
  orderNumber: z.string().regex(/^YEK-\d{4}-[0-9A-Z]{8}$/),
});
