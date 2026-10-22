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

const STATE_CODES = new Set(MEXICAN_STATES.map((state) => state.code));

const text = (max: number) => z.string().trim().min(1).max(max);

/** Buyer's contact (personal data: stored only encrypted). */
const customerSchema = z.strictObject({
  name: z.string().trim().min(3).max(120),
  // Trimmed first, then checked as an e-mail (Zod 4 format schema).
  email: z.string().trim().pipe(z.email().max(254)),
  phone: z.string().regex(/^\d{10}$/, 'Phone must be 10 digits'),
});

/** Mexican shipping address; the state must be one of the 32 zones (T1.1 A). */
const shippingAddressSchema = z.strictObject({
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

/** The six order statuses (FSM of FC 012, `order_statuses`). */
const ORDER_STATUS_CODES = [
  'PENDING_PAYMENT',
  'PAID',
  'EXPIRED',
  'CANCELLED',
  'REFUNDED',
  'NEEDS_REVIEW',
] as const;

/** Answer of `GET /v1/orders/:order_number`: status, method, amounts and times, no personal data. */
export const orderViewSchema = z.object({
  orderNumber: z.string(),
  status: z.enum(ORDER_STATUS_CODES),
  method: z.enum(PAYMENT_METHOD_CODES),
  itemsTotalMxnCents: z.number().int().nonnegative(),
  shippingTotalMxnCents: z.number().int().nonnegative(),
  totalMxnCents: z.number().int().positive(),
  /** End of the payment window, ISO 8601. */
  expiresAt: z.string(),
  /** When the payment was settled, ISO 8601, or null. */
  paidAt: z.string().nullable(),
});

/** The buyer's view of one order. */
export type OrderView = z.infer<typeof orderViewSchema>;

/** Where the processors send the buyer back, per language (pages of FC 012 F3). */
export const CHECKOUT_RETURN_PATHS = {
  'es-MX': { success: '/checkout/exito/', cancel: '/checkout/cancelado/' },
  en: { success: '/en/checkout/success/', cancel: '/en/checkout/cancel/' },
} as const;
