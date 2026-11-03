/**
 * Read-only order contract of the account area and the panel (FC 028 F1, T2.6), shared by the
 * browser and the API like the checkout's (ADR 0008). It depends on Zod and the checkout
 * contract only, so the API bundle can import it.
 *
 * An order is shown with its whole life cycle: status, method, amounts, times, the lines as
 * sold and the payment events the reconciliation recorded. No personal data travels here: the
 * buyer's name, e-mail, phone and address stay encrypted in the database (YekoraALE).
 *
 * @module
 */
import { z } from 'zod';
import { ORDER_STATUS_CODES, orderViewSchema } from '../checkout/checkoutTypes';

/** One order in a list: the buyer's view plus when it was placed and whether it was a test. */
const orderSummarySchema = orderViewSchema.extend({
  /** When the order was placed, ISO 8601. */
  createdAt: z.string(),
  /** True for sandbox purchases (purged before go-live). */
  isTest: z.boolean(),
});

/** A summary of one order. */
export type OrderSummary = z.infer<typeof orderSummarySchema>;

/** One page of orders, newest first. */
export const orderPageSchema = z.object({
  items: z.array(orderSummarySchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});

/** One line as sold: SKU and prices copied at purchase time. */
const orderLineSchema = z.object({
  sku: z.string(),
  quantity: z.number().int().positive(),
  unitPriceMxnCents: z.number().int().positive(),
  lineTotalMxnCents: z.number().int().positive(),
});

/** One payment notification and what the reconciliation decided about it. */
const paymentEventSchema = z.object({
  processor: z.enum(['STRIPE', 'MERCADO_PAGO']),
  eventType: z.string(),
  processorStatus: z.string().nullable(),
  amountMxnCents: z.number().int().nonnegative().nullable(),
  /** The transition it applied, or null when it changed nothing. */
  resultingStatus: z.enum(ORDER_STATUS_CODES).nullable(),
  /** A mismatch or a late payment, flagged for review. */
  isAlert: z.boolean(),
  /** When the API received it, ISO 8601. */
  receivedAt: z.string(),
});

/** One order with its lines and its payment events, in the order they happened. */
export const orderDetailSchema = orderSummarySchema.extend({
  lines: z.array(orderLineSchema),
  paymentEvents: z.array(paymentEventSchema),
});

/** The detail of one order. */
export type OrderDetail = z.infer<typeof orderDetailSchema>;

/** Paging of an order list: 20 per page by default, 50 at most. */
const paging = {
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
};

/** Query of `GET /v1/account/orders`. */
export const accountOrdersQuery = z.strictObject(paging);

/** Query of `GET /v1/admin/orders`: paging, optionally one status. */
export const adminOrdersQuery = z.strictObject({
  ...paging,
  status: z.enum(ORDER_STATUS_CODES).optional(),
});
