/**
 * Cart contract shared by the store, the quote client, the UI and the API route
 * (apps/api/src/routes/cart.ts), so browser and server validate with the same schemas
 * (FC 009, ADR 0008). It depends on Zod only, so the API bundle can import it.
 *
 * The browser keeps SKUs and quantities only: no amounts and no personal data (T1.4,
 * LFPDPPP). Amounts always come from the API quote, which this module also validates, so a
 * response outside the contract is treated as a failed quote instead of being shown.
 *
 * @module
 */
import { z } from 'zod';

/** localStorage key of the guest cart. Named in the privacy and cookie pages (FC 009). */
export const CART_STORAGE_KEY = 'yekora_cart_v1';
/** Most distinct products a cart may hold. */
export const MAX_LINES = 50;
/** Most units of one product per line. */
export const MAX_QUANTITY = 99;

/** One cart line: what the browser stores. */
export interface CartLine {
  /** Product SKU (1–64 characters, the database column). */
  sku: string;
  /** Units, 1–99. */
  quantity: number;
}

/** Stored cart: unique SKUs, bounded size. Anything else is discarded as corrupt. */
export const cartLinesSchema = z
  .array(
    z
      .object({
        sku: z.string().min(1).max(64),
        quantity: z.number().int().min(1).max(MAX_QUANTITY),
      })
      .strict()
  )
  .max(MAX_LINES)
  .refine((lines) => new Set(lines.map((l) => l.sku)).size === lines.length, {
    message: 'Each SKU may appear only once',
  });

/**
 * Destination of a quote (FC 011): the state as its ISO 3166-2:MX code without the MX- prefix
 * (format only; the API decides whether it is a known zone) and an optional 5-digit postal code,
 * reserved for postal-code zones and never stored in the browser (only the state is).
 */
export const destinationSchema = z
  .object({
    stateCode: z
      .string()
      .regex(/^[A-Z]{3}$/, 'State code must be 3 capital letters'),
    postalCode: z
      .string()
      .regex(/^\d{5}$/, 'Postal code must be 5 digits')
      .optional(),
  })
  .strict();

const cents = z.number().int();

/** Quote answered by `POST /v1/cart/quote` (apps/api/src/routes/cart.ts). */
export const cartQuoteSchema = z.object({
  items: z.array(
    z.object({
      sku: z.string(),
      slug: z.string().nullable(),
      name: z.string().nullable(),
      quantity: cents.min(1),
      unitPriceMxnCents: cents.positive().nullable(),
      lineTotalMxnCents: cents.nonnegative().nullable(),
      lineBaseMxnCents: cents.nonnegative().nullable(),
      lineTaxMxnCents: cents.nonnegative().nullable(),
      stockStatus: z.enum([
        'available',
        'low_stock',
        'out_of_stock',
        'unavailable',
      ]),
      availableQuantity: cents.min(0).max(MAX_QUANTITY),
      purchasable: z.boolean(),
    })
  ),
  summary: z
    .object({
      itemsBaseMxnCents: cents.nonnegative(),
      itemsTaxMxnCents: cents.nonnegative(),
      itemsTotalMxnCents: cents.nonnegative(),
      // FC 011: null without a destination; a zero charge when no rule covers it.
      shippingCode: z
        .enum(['STANDARD_RATE', 'FREE_SHIPPING', 'UNSERVICEABLE_DESTINATION'])
        .nullable(),
      shippingBaseMxnCents: cents.nonnegative().nullable(),
      shippingTaxMxnCents: cents.nonnegative().nullable(),
      shippingTotalMxnCents: cents.nonnegative().nullable(),
      serviceable: z.boolean(),
      freeShippingRemainingMxnCents: cents.nonnegative().nullable(),
      subtotalMxnCents: cents.nonnegative(),
      taxMxnCents: cents.nonnegative(),
      totalMxnCents: cents.nonnegative(),
      totalItems: cents.nonnegative(),
      referenceUsdCents: cents.nonnegative().nullable(),
      exchangeRate: z
        .object({ series: z.string(), date: z.string(), rate: z.string() })
        .nullable(),
    })
    // T1.3 (FC 009) and T2 (FC 011): never show a breakdown that does not add up, for the
    // items, for the shipping line and for the grand total that adds both.
    .refine(
      (s) =>
        s.itemsBaseMxnCents + s.itemsTaxMxnCents === s.itemsTotalMxnCents &&
        (s.shippingBaseMxnCents ?? 0) + (s.shippingTaxMxnCents ?? 0) ===
          (s.shippingTotalMxnCents ?? 0) &&
        s.subtotalMxnCents ===
          s.itemsBaseMxnCents + (s.shippingBaseMxnCents ?? 0) &&
        s.taxMxnCents === s.itemsTaxMxnCents + (s.shippingTaxMxnCents ?? 0) &&
        s.subtotalMxnCents + s.taxMxnCents === s.totalMxnCents
    ),
  warnings: z.array(
    z.object({
      sku: z.string(),
      code: z.enum(['unavailable', 'out_of_stock', 'insufficient_stock']),
    })
  ),
});

/** A validated quote. */
export type CartQuote = z.infer<typeof cartQuoteSchema>;
