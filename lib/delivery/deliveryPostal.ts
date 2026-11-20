/**
 * The postal code the browser's location resolved to (FC 055 T2.6, Enmienda 1), kept only in this
 * tab's session storage under `yekora_delivery_postal_v1`, so the header does not ask the position
 * and the geocoder again on every page. It is five digits and nothing else: the coordinates are
 * never stored, and the value is gone when the tab closes.
 *
 * @module
 */
import { asPostalCode } from './reverseGeocode';

const STORAGE_KEY = 'yekora_delivery_postal_v1';

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
 * Remembers the postal code for this tab.
 *
 * @param code - Five digits.
 * @param storage - Session storage, injectable for tests.
 */
export function rememberDeliveryPostal(
  code: string,
  storage: Storage | null = sessionStore()
): void {
  try {
    storage?.setItem(STORAGE_KEY, code);
  } catch {
    // quota or privacy mode: the code is just asked again on the next page
  }
}

/**
 * The postal code this tab resolved before, if it is still stored and well formed.
 *
 * @param storage - Session storage, injectable for tests.
 */
export function recallDeliveryPostal(
  storage: Storage | null = sessionStore()
): string | null {
  try {
    return asPostalCode(storage?.getItem(STORAGE_KEY));
  } catch {
    return null; // blocked storage
  }
}
