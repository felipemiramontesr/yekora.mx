/**
 * Contract of the order fulfillment (FC 068, T1.1 and T1.2), shared by the browser and the API
 * (ADR 0008: one set of Zod schemas for both ends): what `POST /v1/admin/orders/:order_number/ship`
 * accepts and what the three transitions (`prepare`, `ship`, `deliver`) answer. It depends on Zod
 * only, so the site bundle can import it.
 *
 * @module
 */
import { z } from 'zod';
import { FULFILLMENT_CODES } from '../checkout/checkoutTypes';

/** A link a carrier gives to follow a parcel: http or https only, never a script or another scheme. */
const trackingLink = z
  .string()
  .trim()
  .max(512)
  .pipe(z.url())
  .refine((link) => /^https?:\/\//i.test(link));

/**
 * Body of `POST /v1/admin/orders/:order_number/ship` (T1.1 P): the carrier and the tracking
 * number are mandatory, the link to follow the parcel is optional.
 */
export const shipRequestSchema = z.strictObject({
  carrier: z.string().trim().min(1).max(64),
  trackingNumber: z.string().trim().min(1).max(128),
  trackingUrl: trackingLink.optional(),
});

/** The shipment a request asks to register. */
export type ShipRequest = z.infer<typeof shipRequestSchema>;

/** Answer of a transition: the step the order reached and what its parcel carries so far. */
export const fulfillmentResultSchema = z.object({
  orderNumber: z.string(),
  fulfillment: z.enum(FULFILLMENT_CODES),
  carrier: z.string().nullable(),
  trackingNumber: z.string().nullable(),
  trackingUrl: z.string().nullable(),
  /** When it left, ISO 8601, or null while it has not. */
  shippedAt: z.string().nullable(),
  /** When it arrived, ISO 8601, or null while it has not. */
  deliveredAt: z.string().nullable(),
});

/** The result of a transition. */
export type FulfillmentResult = z.infer<typeof fulfillmentResultSchema>;
