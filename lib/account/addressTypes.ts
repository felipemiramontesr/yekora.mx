/**
 * The data an account keeps to ship and charge (FC 051): its profile (name and phone) and its
 * book of delivery addresses. One set of Zod schemas for the browser and the API (ADR 0008).
 *
 * - An address that can ship an order is checked with the very schemas `POST /v1/checkout` uses
 *   (contact and address, FC 012), so a saved address that passes here always passes the checkout.
 *   Its state must be the one its postal code belongs to.
 * - The answers of a write carry no personal data beyond the account's own name: the API keeps
 *   what it answered to retry a request, and a phone or a street must never be kept in the clear.
 *
 * @module
 */
import { z } from 'zod';
import { stateOfPostalCode } from '../cart/postalRanges';
import {
  customerSchema,
  shippingAddressSchema,
} from '../checkout/checkoutTypes';

/** The most addresses an account keeps (Ω, 2026-11-15). */
export const MAX_USER_ADDRESSES = 5;

/** Body of `PATCH /v1/account/profile`: the e-mail is the account's identifier and never changes. */
export const profileUpdateRequestSchema = z.strictObject({
  fullName: z.string().trim().min(2).max(150),
  phone: customerSchema.shape.phone,
});

/** Answer of `PATCH /v1/account/profile`: the name only, never the phone (T1.1). */
export const profileUpdatedSchema = z.object({ fullName: z.string() });

/** The fields of an address that can ship an order: who receives it, where, and what to call it. */
const addressFields = shippingAddressSchema.extend({
  name: customerSchema.shape.name,
  phone: customerSchema.shape.phone,
  /** What the person calls it («Casa», «Oficina»). */
  label: z.string().trim().min(1).max(40).optional(),
});

/** What the sealed address holds: its fields, whole or, for the one given at sign-up, the code only. */
export const addressContentSchema = z.union([
  addressFields,
  z.strictObject({ postalCode: addressFields.shape.postalCode }),
]);

/** Whether an address' state is the one of its postal code. */
const stateMatches = (address: { postalCode: string; stateCode: string }) =>
  stateOfPostalCode(address.postalCode) === address.stateCode;

/** Body of `POST /v1/account/addresses` and of the full edit of one: a whole address. */
export const addressUpsertRequestSchema = addressFields
  .extend({ isDefault: z.boolean().optional() })
  .refine(stateMatches, 'The state does not match the postal code');

/**
 * Body of `PATCH /v1/account/addresses/:id`: a whole address (which also completes the one given
 * at sign-up) or just the choice of this one as the default.
 */
export const addressPatchRequestSchema = z.union([
  addressUpsertRequestSchema,
  z.strictObject({ isDefault: z.literal(true) }),
]);

/** Path parameter of one address. */
export const addressParams = z.object({ id: z.uuid() });

/** One address as its holder reads it; an incomplete one holds its postal code and state only. */
const addressViewSchema = z.object({
  id: z.uuid(),
  isDefault: z.boolean(),
  /** Whether it can ship an order; the one given at sign-up cannot until it is completed. */
  isComplete: z.boolean(),
  stateCode: z.string(),
  postalCode: z.string().regex(/^\d{5}$/),
  label: z.string().nullable(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  street: z.string().nullable(),
  exteriorNumber: z.string().nullable(),
  interiorNumber: z.string().nullable(),
  neighborhood: z.string().nullable(),
  municipality: z.string().nullable(),
  references: z.string().nullable(),
});

/** An address as its holder reads it. */
export type AddressView = z.infer<typeof addressViewSchema>;

/** Answer of `GET /v1/account/addresses`: the book, oldest first, and the most it may hold. */
export const addressListSchema = z.object({
  items: z.array(addressViewSchema),
  max: z.number().int().positive(),
});

/** Answer of a write to one address: what changed, never what it says (T1.2, T1.3). */
export const addressSavedSchema = z.object({
  id: z.uuid(),
  isDefault: z.boolean(),
  isComplete: z.boolean(),
});

/** An address as the form sends it, without the choice of default. */
export type AddressInput = z.infer<typeof addressFields>;
