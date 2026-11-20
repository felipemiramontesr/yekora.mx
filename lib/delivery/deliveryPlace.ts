/**
 * The place the browser's location resolved to (FC 055 T2.6, T2.9, Enmienda 1), kept only in this
 * tab's session storage under `yekora_delivery_place_v1`, so the header does not ask the position
 * and the geocoder again on every page. It is five digits (a postal code) or the three letters of
 * a state of the closed list, and nothing else: the coordinates are never stored, and the value is
 * gone when the tab closes.
 *
 * @module
 */
import { asPostalCode } from './reverseGeocode';
import { asStateCode } from './stateAbbreviations';

const STORAGE_KEY = 'yekora_delivery_place_v1';

function sessionStore(): Storage | null {
  try {
    return globalThis.window === undefined
      ? null
      : globalThis.window.sessionStorage;
  } catch {
    return null; // storage blocked by the browser
  }
}

/**
 * Keeps a value only when it is a postal code or a state code of the list.
 *
 * @param value - Whatever was stored or resolved.
 * @returns The postal code or the state code, or null.
 */
function asPlace(value: unknown): string | null {
  return asPostalCode(value) ?? asStateCode(value);
}

/**
 * Remembers the place for this tab.
 *
 * @param place - A postal code or a state code.
 * @param storage - Session storage, injectable for tests.
 */
export function rememberDeliveryPlace(
  place: string,
  storage: Storage | null = sessionStore()
): void {
  try {
    storage?.setItem(STORAGE_KEY, place);
  } catch {
    // quota or privacy mode: the place is just asked again on the next page
  }
}

/**
 * The place this tab resolved before, if it is still stored and well formed.
 *
 * @param storage - Session storage, injectable for tests.
 */
export function recallDeliveryPlace(
  storage: Storage | null = sessionStore()
): string | null {
  try {
    return asPlace(storage?.getItem(STORAGE_KEY));
  } catch {
    return null; // blocked storage
  }
}
