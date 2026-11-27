/**
 * Checkout contract shared by the browser and the API route (FC 012, ADR 0008: one set of Zod
 * schemas for both ends). It depends on Zod and the cart contract only, so the API bundle can
 * import it.
 *
 * The browser sends the cart lines, the chosen payment method, the buyer's contact and
 * shipping address, the privacy consent and the total it showed. The server re-quotes
 * everything; the total is only compared (409 PRICE_CHANGED when it moved), never charged.
 * Address validity includes the state being one of the 32 shipping zones (T1.1 A).
 *
 * @module
 */
import { z } from 'zod';
import { cartLinesSchema } from '../cart/cartTypes';
import { MEXICAN_STATES } from '../cart/mxStates';

/** Methods the buyer picks in the checkout (Ω, 112_AN): card and OXXO by Stripe, the rest by Mercado Pago. */
export const PAYMENT_METHOD_CODES = [
  'CARD',
  'OXXO',
  'SPEI',
  'MERCADO_PAGO_BALANCE',
] as const;

/**
 * The methods an order may carry: the checkout's, plus the counter's (FC 076), which the checkout
 * never offers nor accepts.
 */
const ORDER_METHOD_CODES = [
  ...PAYMENT_METHOD_CODES,
  'POS_CASH',
  'POS_CARD_MANUAL',
] as const;

const STATE_CODES = new Set(MEXICAN_STATES.map((state) => state.code));

const text = (max: number) => z.string().trim().min(1).max(max);

/** Buyer's contact (personal data: stored only encrypted). */
export const customerSchema = z.strictObject({
  name: z.string().trim().min(3).max(120),
  // Trimmed first, then checked as an e-mail (Zod 4 format schema).
  email: z.string().trim().pipe(z.email().max(254)),
  phone: z.string().regex(/^\d{10}$/, 'Phone must be 10 digits'),
});

/** Mexican shipping address; the state must be one of the 32 zones (T1.1 A). */
export const shippingAddressSchema = z.strictObject({
  street: text(120),
  exteriorNumber: text(20),
  interiorNumber: z.string().trim().max(20).optional(),
  neighborhood: text(120),
  municipality: text(120),
  stateCode: z
    .string()
    .refine((code) => STATE_CODES.has(code), 'Unknown Mexican state'),
  postalCode: z.string().regex(/^\d{5}$/, 'Postal code must be 5 digits'),
  references: z.string().trim().max(200).optional(),
});

/** Body of `POST /v1/checkout`. */
export const checkoutRequestSchema = z.strictObject({
  items: cartLinesSchema,
  method: z.enum(PAYMENT_METHOD_CODES),
  customer: customerSchema,
  address: shippingAddressSchema,
  privacyConsent: z.boolean(),
  /**
   * A signed-in buyer who typed a new address asks to keep it in their book of addresses (FC 051
   * T1.4). Ignored for a guest and when the account already holds five.
   */
  saveAddress: z.boolean().optional(),
  /**
   * A signed-in buyer paying by card asks Stripe to keep it for later purchases (FC 054 T1.3).
   * Ignored for a guest and for any other method.
   */
  savePaymentMethod: z.boolean().optional(),
  /** Total with shipping the buyer saw, MXN cents: compared, never charged. */
  expectedTotalMxnCents: z.number().int().nonnegative(),
});

/** A validated checkout request. */
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;

/** Answer of `POST /v1/checkout` (201). */
export const checkoutSessionSchema = z.object({
  orderNumber: z.string(),
  /** Order access token: kept by the browser for the return page, never sent to a processor. */
  accessToken: z.string(),
  /** Hosted payment page (Stripe or Mercado Pago). */
  redirectUrl: z.url(),
  /** End of the stock reservation, ISO 8601. */
  expiresAt: z.string(),
  totalMxnCents: z.number().int().positive(),
});

/** The six order statuses a client already knows (FSM of FC 012, `order_statuses`). */
export const ORDER_STATUS_CODES = [
  'PENDING_PAYMENT',
  'PAID',
  'EXPIRED',
  'CANCELLED',
  'REFUNDED',
  'NEEDS_REVIEW',
] as const;

/** The three steps of the fulfillment of a paid order (FC 068, `order_statuses` 7, 8 and 9). */
export const FULFILLMENT_CODES = ['PREPARING', 'SHIPPED', 'DELIVERED'] as const;

/** One of the six statuses a client knows. */
type OrderStatusCode = (typeof ORDER_STATUS_CODES)[number];

/** One step of the fulfillment. */
type FulfillmentCode = (typeof FULFILLMENT_CODES)[number];

/**
 * Splits the status of the database into what the API has always answered and what FC 068 adds.
 * An order being prepared, shipped or delivered has been paid, so its `status` stays `PAID` and
 * its step travels apart as `fulfillment`: a new answer property, which ADR 0014 allows, instead
 * of three new values of a closed enum, which would break a web bundle cached before the change.
 *
 * @param code - `order_statuses.code`, any of the nine.
 * @returns The status a client knows and the fulfillment step, or null before the order has one.
 */
export function splitStatus(code: string): {
  status: OrderStatusCode;
  fulfillment: FulfillmentCode | null;
} {
  const step = FULFILLMENT_CODES.find((candidate) => candidate === code);
  return step === undefined
    ? { status: code as OrderStatusCode, fulfillment: null }
    : { status: 'PAID', fulfillment: step };
}

/** Answer of `GET /v1/orders/:order_number`: status, method, amounts and times, no personal data. */
export const orderViewSchema = z.object({
  orderNumber: z.string(),
  status: z.enum(ORDER_STATUS_CODES),
  method: z.enum(ORDER_METHOD_CODES),
  itemsTotalMxnCents: z.number().int().nonnegative(),
  shippingTotalMxnCents: z.number().int().nonnegative(),
  totalMxnCents: z.number().int().positive(),
  /** End of the payment window, ISO 8601. */
  expiresAt: z.string(),
  /** When the payment was settled, ISO 8601, or null. */
  paidAt: z.string().nullable(),
  /**
   * Where a paid order is in its fulfillment (FC 068): being prepared, shipped or delivered, or
   * null before that. Its `status` stays `PAID` meanwhile.
   */
  fulfillment: z.enum(FULFILLMENT_CODES).nullable().optional(),
});

/** The buyer's view of one order. */
export type OrderView = z.infer<typeof orderViewSchema>;

/** Where the processors send the buyer back, per language (pages of FC 012 F3). */
export const CHECKOUT_RETURN_PATHS = {
  'es-MX': { success: '/checkout/exito/', cancel: '/checkout/cancelado/' },
  en: { success: '/en/checkout/success/', cancel: '/en/checkout/cancel/' },
} as const;
