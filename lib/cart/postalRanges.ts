/**
 * Mexican postal code → state (FC 047 T1.3): which of the 32 states a five-digit code belongs to,
 * by its first two digits. Postal codes are issued in blocks per state, so a table of 32 ranges
 * of about 1 KB covers them without bundling the full postal catalog.
 *
 * The result is informational: it validates the shape of what a buyer typed in their address and
 * prefills the state. It is approximate at some borders, so it never prices a shipment: the
 * buyer confirms the state at checkout (T2.3).
 *
 * @module
 */

/** One block of the table: first two digits, inclusive, and the state they belong to. */
type PostalRange = readonly [from: number, to: number, state: string];

/** Blocks of two-digit prefixes per state (ISO 3166-2:MX code without the MX- prefix). */
const RANGES: readonly PostalRange[] = [
  [1, 16, 'CMX'],
  [20, 20, 'AGU'],
  [21, 22, 'BCN'],
  [23, 23, 'BCS'],
  [24, 24, 'CAM'],
  [25, 27, 'COA'],
  [28, 28, 'COL'],
  [29, 30, 'CHP'],
  [31, 33, 'CHH'],
  [34, 35, 'DUR'],
  [36, 38, 'GUA'],
  [39, 41, 'GRO'],
  [42, 43, 'HID'],
  [44, 49, 'JAL'],
  [50, 57, 'MEX'],
  [58, 61, 'MIC'],
  [62, 62, 'MOR'],
  [63, 63, 'NAY'],
  [64, 67, 'NLE'],
  [68, 71, 'OAX'],
  [72, 75, 'PUE'],
  [76, 76, 'QUE'],
  [77, 77, 'ROO'],
  [78, 79, 'SLP'],
  [80, 82, 'SIN'],
  [83, 85, 'SON'],
  [86, 86, 'TAB'],
  [87, 89, 'TAM'],
  [90, 90, 'TLA'],
  [91, 96, 'VER'],
  [97, 97, 'YUC'],
  [98, 99, 'ZAC'],
];

/** The shape of a postal code: exactly five digits. */
const POSTAL_CODE = /^\d{5}$/;

/**
 * The state of a postal code.
 *
 * @param postalCode - Five digits, as the buyer typed them.
 * @returns The state code, or null when the text is not five digits or falls in no block.
 */
export function stateOfPostalCode(postalCode: string): string | null {
  if (!POSTAL_CODE.test(postalCode)) return null;
  const prefix = Number(postalCode.slice(0, 2));
  const hit = RANGES.find(([from, to]) => prefix >= from && prefix <= to);
  return hit ? hit[2] : null;
}
