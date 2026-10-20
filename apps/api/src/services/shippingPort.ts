/**
 * Port of the shipping rate sources (FC 011 F1, ADR 0010). The cart quote asks a
 * {@link ShippingRateProvider} for the charge of one purchase and does not know where the rate
 * comes from: v1 is the internal rate tables (`shippingRates.ts`); a live carrier or aggregator
 * (Envia.com, Skydropx, K-28) becomes another adapter behind the same contract, and CI uses
 * deterministic doubles, never the network.
 *
 * @module
 */
import type { PhysicalLine } from './dimensioning';
import type { ShippingOutcome } from './shippingEngine';

/** One product line of the purchase, with what shipping needs about it. */
interface ShipmentLine extends PhysicalLine {
  /** `shipping_classes.id` of the product. */
  classId: number;
}

/** The purchase to price. */
export interface ShipmentRequest {
  /** Destination state, ISO 3166-2:MX code without the MX- prefix (e.g. ZAC). */
  stateCode: string;
  /** Purchasable lines only (the cart quote has already excluded the rest). */
  lines: readonly ShipmentLine[];
  /** Items total with VAT, cents. */
  itemsTotalMxnCents: number;
}

/** Answer of a provider: an unknown destination (T1.1 D = ⊥) or the engine's outcome. */
export type ShipmentQuote =
  { serviceable: false; code: 'INVALID_DESTINATION' } | ShippingOutcome;

/** A source of shipping rates. */
export interface ShippingRateProvider {
  /**
   * Prices the shipment of one purchase, once per purchase.
   *
   * @param request - Destination, purchasable lines and items total.
   * @returns INVALID_DESTINATION for a state it does not know, otherwise the priced outcome.
   */
  quote(request: ShipmentRequest): Promise<ShipmentQuote>;
}
