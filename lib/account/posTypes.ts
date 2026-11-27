/**
 * Contract of the point of sale (FC 076, K-79): the till shifts, the cash movements, the products
 * of the counter, the sale and its receipt. Zod only, so the browser can share it (ADR 0008). The
 * price and the totals are the server's: a sale names SKUs and units, never prices. No card number
 * ever travels here (T0.1).
 *
 * @module
 */
import { z } from 'zod';

const CENTS_MAX = 100_000_000;
const cents = z.number().int().min(0).max(CENTS_MAX);

/** `POST /v1/admin/pos/shifts/open`: the cash the drawer starts with. */
export const openShiftSchema = z.strictObject({
  openingCashMxnCents: cents,
});

/** The open shift as the counter sees it: never the expected cash, so the count stays blind. */
export const posShiftSchema = z.strictObject({
  id: z.number().int().positive(),
  cashierUserId: z.string(),
  openedAt: z.string(),
  openingCashMxnCents: z.number().int().min(0),
});

/** The open shift, or null. */
export const currentShiftSchema = z.strictObject({
  shift: posShiftSchema.nullable(),
});

/** `POST /v1/admin/pos/shifts/movements`: cash put in or taken out. */
export const cashMovementSchema = z.strictObject({
  shiftId: z.number().int().positive(),
  type: z.enum(['IN', 'OUT']),
  amountMxnCents: z.number().int().min(1).max(CENTS_MAX),
  reason: z.string().trim().min(1).max(255),
});

/** A movement as recorded. */
export const cashMovementResultSchema = z.strictObject({
  id: z.number().int().positive(),
  shiftId: z.number().int().positive(),
  type: z.enum(['IN', 'OUT']),
  amountMxnCents: z.number().int().positive(),
});

/** `POST /v1/admin/pos/shifts/:id/close`: the cash counted, with the reason of a difference. */
export const closeShiftSchema = z.strictObject({
  countedCashMxnCents: cents,
  notes: z.string().trim().max(255).optional(),
});

/** Path parameter of a shift. */
export const shiftParams = z.strictObject({
  id: z.coerce.number().int().positive(),
});

/** What a closed shift answers: the count against what was expected. */
export const closedShiftSchema = z.strictObject({
  id: z.number().int().positive(),
  expectedCashMxnCents: z.number().int().min(0),
  countedCashMxnCents: z.number().int().min(0),
  differenceMxnCents: z.number().int(),
});

/** Query of `GET /v1/admin/pos/products`. */
export const posProductsQuery = z.strictObject({
  q: z.string().trim().min(1).max(64).optional(),
});

/** The products of the counter, with what is left after the web's reservations. */
export const posProductsSchema = z.strictObject({
  items: z.array(
    z.strictObject({
      sku: z.string(),
      nameEs: z.string(),
      nameEn: z.string(),
      priceMxnCents: z.number().int().positive(),
      available: z.number().int(),
    })
  ),
});

/** One line of a sale. */
const saleLine = z.strictObject({
  sku: z.string().min(1).max(64),
  quantity: z.number().int().min(1).max(99),
});

/**
 * `POST /v1/admin/pos/checkout`. The payment is taken loosely here so that a wrong method, amount
 * or voucher answers with its own row of T1.3 and not a generic refusal.
 */
export const posSaleSchema = z.strictObject({
  items: z
    .array(saleLine)
    .min(1)
    .max(50)
    .refine(
      (items) => new Set(items.map((item) => item.sku)).size === items.length,
      'A product appears twice'
    ),
  payment: z.strictObject({
    method: z.string().max(32),
    tenderedMxnCents: cents.optional(),
    confirmedAmountMxnCents: cents.optional(),
    terminalAuthCode: z.string().max(64).optional(),
    cardLastFour: z.string().max(16).optional(),
    cardBrand: z.string().max(16).optional(),
    voucherFolio: z.string().max(64).optional(),
  }),
  /** Where to send the receipt, only if the buyer wants it. */
  customerEmail: z.email().max(254).optional(),
});

/** A sale made: its order number and what it charged. */
export const posSaleResultSchema = z.strictObject({
  orderNumber: z.string(),
  method: z.enum(['POS_CASH', 'POS_CARD_MANUAL']),
  totalMxnCents: z.number().int().positive(),
  changeMxnCents: z.number().int().min(0),
});

/** Query of the receipt: the width of the thermal paper. */
export const receiptQuery = z.strictObject({
  width: z.enum(['80', '58']).default('80'),
});

/** The receipt of a counter sale as text lines for the thermal printer. */
export const receiptSchema = z.strictObject({
  orderNumber: z.string(),
  widthMm: z.union([z.literal(80), z.literal(58)]),
  lines: z.array(z.string()),
});
