/**
 * Money rules (FC 008). Prices are stored only in MXN cents; the USD reference is derived from
 * Banxico's FIX (pesos per 1 USD), so there is a single source of truth.
 *
 * @module
 */

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
