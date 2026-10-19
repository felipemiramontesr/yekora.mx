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
      subtotalMxnCents: cents.nonnegative(),
      taxMxnCents: cents.nonnegative(),
      totalMxnCents: cents.nonnegative(),
      totalItems: cents.nonnegative(),
      referenceUsdCents: cents.nonnegative().nullable(),
      exchangeRate: z
        .object({ series: z.string(), date: z.string(), rate: z.string() })
        .nullable(),
    })
    // T1.3: never show a breakdown that does not add up.
    .refine((s) => s.subtotalMxnCents + s.taxMxnCents === s.totalMxnCents),
  warnings: z.array(
    z.object({
      sku: z.string(),
      code: z.enum(['unavailable', 'out_of_stock', 'insufficient_stock']),
    })
  ),
});

/** A validated quote. */
export type CartQuote = z.infer<typeof cartQuoteSchema>;
