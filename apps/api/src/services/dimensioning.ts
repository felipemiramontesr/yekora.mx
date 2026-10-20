/**
 * Chargeable weight of a purchase (FC 011 F1, ADR 0010, T2 «Invariante de Cubicaje por Pedido»).
 *
 * Mexican carriers bill the larger of the real weight and the volumetric weight, with the
 * divisor 5000 for centimetres and kilograms: L × W × H (cm) / 5000 = kg. In the integer units
 * of the database the same ratio holds: L × W × H (mm) / 5000 = grams, because both sides
 * scale by 1000. For a whole purchase (one shipment, Ω: «por compra o por mochila»):
 *
 *   physical   = Σ weight_grams × quantity
 *   volumetric = ⌈ Σ (length_mm × width_mm × height_mm × quantity) / 5000 ⌉
 *   chargeable = max(physical, volumetric)
 *
 * The sums use BigInt so a large volume never loses precision (a JavaScript number is exact
 * only up to 2^53); the result must fit back in a safe integer or the function throws.
 *
 * @module
 */

/** mm³ per gram of volumetric weight (the carriers' 5000 cm³ per kg). */
const VOLUMETRIC_DIVISOR = BigInt(5000);

/** Physical data of one line of the purchase. */
export interface PhysicalLine {
  /** Units of this product. */
  quantity: number;
  /** Real weight of one unit, grams. */
  weightGrams: number;
  /** Packed length of one unit, millimetres. */
  lengthMm: number;
  /** Packed width of one unit, millimetres. */
  widthMm: number;
  /** Packed height of one unit, millimetres. */
  heightMm: number;
}

/** Weights of a purchase, in grams. */
interface PurchaseWeight {
  /** Σ weight × quantity. */
  physicalGrams: number;
  /** ⌈ Σ volume × quantity / 5000 ⌉. */
  volumetricGrams: number;
  /** The larger of the two: what the carrier bills. */
  chargeableGrams: number;
}

/** BigInt to number, refusing values a number cannot hold exactly. */
function toSafeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('purchase weight exceeds the exact integer range');
  }
  return Number(value);
}

/**
 * Physical, volumetric and chargeable weight of one purchase (T2: chargeable equals
 * max(physical, ⌈volume / 5000⌉), computed over the whole purchase, never per product).
 *
 * @param lines - Every line of the purchase with its physical data (integers, as stored).
 * @returns The three weights in grams; all zero for an empty purchase.
 */
export function purchaseWeight(lines: readonly PhysicalLine[]): PurchaseWeight {
  let physical = BigInt(0);
  let volume = BigInt(0);
  for (const line of lines) {
    const quantity = BigInt(line.quantity);
    physical += BigInt(line.weightGrams) * quantity;
    volume +=
      BigInt(line.lengthMm) *
      BigInt(line.widthMm) *
      BigInt(line.heightMm) *
      quantity;
  }
  // Ceiling division on non-negative integers: a partial gram is billed as a whole one.
  const volumetric =
    (volume + VOLUMETRIC_DIVISOR - BigInt(1)) / VOLUMETRIC_DIVISOR;
  const chargeable = physical > volumetric ? physical : volumetric;
  return {
    physicalGrams: toSafeNumber(physical),
    volumetricGrams: toSafeNumber(volumetric),
    chargeableGrams: toSafeNumber(chargeable),
  };
}
