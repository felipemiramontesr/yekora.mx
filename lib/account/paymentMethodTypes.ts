/**
 * Contract of the saved cards of an account (FC 054 T0.2): what `GET /v1/account/payment-methods`,
 * `POST /v1/account/payment-methods/setup` and `DELETE /v1/account/payment-methods/:id` answer,
 * shared by the API and the browser.
 *
 * A saved card lives at Stripe, never here: the API asks Stripe for these four harmless facts each
 * time they are shown and forgets them (PCI DSS SAQ A, FC 054 T2.1). There is no card number, no
 * security code and no holder name in any of these shapes.
 *
 * @module
 */
import { z } from 'zod';

/** What identifies a card of Stripe in a URL: `pm_` and its opaque id. */
export const paymentMethodParams = z.object({
  id: z.string().regex(/^pm_[A-Za-z0-9]{8,64}$/),
});

/** One saved card as the account area shows it. */
const savedCardSchema = z.object({
  /** Stripe's id of the card (`pm_…`). */
  id: z.string().regex(/^pm_[A-Za-z0-9]{8,64}$/),
  /** Brand of the card as Stripe names it (`visa`, `mastercard`, `amex`…). */
  brand: z.string().min(1).max(32),
  /** The last four digits. */
  last4: z.string().regex(/^\d{4}$/),
  /** Month of expiry, 1 to 12. */
  expMonth: z.number().int().min(1).max(12),
  /** Year of expiry, four digits. */
  expYear: z.number().int().min(2000).max(2200),
});

/** One saved card. */
export type SavedCard = z.infer<typeof savedCardSchema>;

/** Answer of `GET /v1/account/payment-methods`. */
export const paymentMethodListResponseSchema = z.object({
  items: z.array(savedCardSchema),
  /** Whether the account already has a customer at Stripe (no cards can exist before). */
  hasCustomer: z.boolean(),
});

/** Answer of `POST /v1/account/payment-methods/setup` (201). */
export const paymentMethodSetupResponseSchema = z.object({
  /** The hosted page of Stripe where the person enters the card. */
  redirectUrl: z.url(),
});

/** Answer of `DELETE /v1/account/payment-methods/:id` (200). */
export const paymentMethodDetachResponseSchema = z.object({
  detached: z.literal(true),
});
