/**
 * The closed list of the 32 Mexican states the delivery indicator may show by abbreviation when no
 * postal code is known (FC 055 T2.9, Enmienda 1; list approved by Ω in 480_AN). The key is the
 * code of `lib/cart/mxStates.ts`, which is also what the reverse geocoder answers as its ISO
 * 3166-2 subdivision once the `MX-` prefix is dropped. A unit test keeps both lists identical.
 *
 * @module
 */

/** Usual abbreviation of each state, the same in Spanish and in English. */
const ABBREVIATIONS: Readonly<Record<string, string>> = {
  AGU: 'Ags.',
  BCN: 'BC',
  BCS: 'BCS',
  CAM: 'Camp.',
  CHP: 'Chis.',
  CHH: 'Chih.',
  CMX: 'CDMX',
  COA: 'Coah.',
  COL: 'Col.',
  DUR: 'Dgo.',
  MEX: 'Edomex',
  GUA: 'Gto.',
  GRO: 'Gro.',
  HID: 'Hgo.',
  JAL: 'Jal.',
  MIC: 'Mich.',
  MOR: 'Mor.',
  NAY: 'Nay.',
  NLE: 'NL',
  OAX: 'Oax.',
  PUE: 'Pue.',
  QUE: 'Qro.',
  ROO: 'Q. Roo',
  SLP: 'SLP',
  SIN: 'Sin.',
  SON: 'Son.',
  TAB: 'Tab.',
  TAM: 'Tamps.',
  TLA: 'Tlax.',
  VER: 'Ver.',
  YUC: 'Yuc.',
  ZAC: 'Zac.',
};

/** Prefix of an ISO 3166-2 code of Mexico, as the geocoders write it. */
const ISO_PREFIX = 'MX-';

/**
 * The state code of a value the geocoders gave, if it is one of the 32.
 *
 * @param value - An ISO 3166-2 code such as `MX-ZAC`, or the bare code `ZAC`.
 * @returns The bare code (`ZAC`), or null when it is not on the closed list.
 */
export function asStateCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.startsWith(ISO_PREFIX)
    ? value.slice(ISO_PREFIX.length)
    : value;
  return Object.hasOwn(ABBREVIATIONS, code) ? code : null;
}

/**
 * The usual abbreviation of a state.
 *
 * @param code - A code `asStateCode` accepted.
 * @returns For example `Zac.`.
 */
export function abbreviationOf(code: string): string {
  return ABBREVIATIONS[code] ?? code;
}

/** The codes on the list, for the test that compares it with the shipping states. */
export const STATE_CODES: readonly string[] = Object.keys(ABBREVIATIONS);
