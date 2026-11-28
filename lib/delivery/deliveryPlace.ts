/**
 * Where this tab delivers when no saved address says it (FC 055, FC 078 F1), kept only in the
 * tab's session storage under `yekora_delivery_place_v1`: the postal code the person typed in the
 * header, or what the browser's location resolved to. It is five digits (a postal code) or the
 * three letters of a state of the closed list, and nothing else: coordinates are never stored, and
 * the value is gone when the tab closes. Whoever shows it is told when it changes.
 *
 * @module
 */
import { asPostalCode } from './reverseGeocode';
import { asStateCode } from './stateAbbreviations';

const STORAGE_KEY = 'yekora_delivery_place_v1';

const listeners = new Set<() => void>();

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
 * Remembers the place for this tab and tells whoever listens.
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
  for (const listener of listeners) listener();
}

/**
 * The place this tab holds, if it is still stored and well formed.
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

/**
 * Calls `listener` every time a place is remembered.
 *
 * @param listener - What to call.
 * @returns A function that stops the calls.
 */
export function subscribeDeliveryPlace(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
