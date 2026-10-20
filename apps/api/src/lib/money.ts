/**
 * Money rules (FC 008). Prices are stored only in MXN cents; the USD reference is derived from
 * Banxico's FIX (pesos per 1 USD), so there is a single source of truth. The VAT split lives
 * here too (FC 011): product lines and the shipping charge must use the very same rule.
 *
 * @module
 */

/**
 * Splits a net amount (VAT included, 073_AN) into its base and the 16 % VAT it carries, in
 * integer cents: `base = round(total × 100 / 116)`, `tax = total − base`, so base + tax equals
 * the total by construction. Used for every product line (FC 009) and for shipping (FC 011).
 *
 * @param totalMxnCents - Net amount in MXN cents, VAT included.
 * @returns Base and tax in cents; they always add up to the total.
 */
export function splitVat(totalMxnCents: number): { base: number; tax: number } {
  const base = Math.round((totalMxnCents * 100) / 116);
  return { base, tax: totalMxnCents - base };
}

/**
 * USD reference price in cents: `Math.round(price_mxn_cents / fix)`.
 * Canonical case of the FC: 485000 MXN cents with FIX 18.5000 gives 26216 USD cents.
 *
 * @param priceMxnCents - Price in Mexican peso cents.
 * @param fix - Banxico FIX, pesos per 1 USD (4 decimals as stored).
 * @returns USD cents, or null when there is no valid FIX to convert with.
 */
export function usdCents(
  priceMxnCents: number,
  fix: number | null
): number | null {
  if (fix === null || !Number.isFinite(fix) || fix <= 0) return null;
  return Math.round(priceMxnCents / fix);
}
