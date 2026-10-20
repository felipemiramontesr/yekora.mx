/**
 * Delivery state of the guest cart (FC 011 F3): the one shipping detail the browser remembers
 * between visits, so the cart can quote shipping again without asking.
 *
 * It keeps only the state's ISO 3166-2:MX code (e.g. ZAC) under its own key, never a postal code
 * or an address (personal data, LFPDPPP); `yekora_cart_v1` is left exactly as it was. A stored
 * value that is not one of the 32 states is ignored. Same shape as the cart store
 * (`useSyncExternalStore`, other tabs through the `storage` event, best-effort storage).
 *
 * @module
 */
import { MEXICAN_STATES } from './mxStates';

/** localStorage key. Named in the privacy and cookie pages (FC 011). */
const STORAGE_KEY = 'yekora_shipping_state_v1';

const KNOWN = new Set(MEXICAN_STATES.map((state) => state.code));

/** The remembered delivery state as the UI uses it. */
interface DestinationStore {
  /** Code of the chosen state, or null when none was chosen. */
  getSnapshot(): string | null;
  /**
   * Calls `listener` after every change.
   *
   * @returns A function that stops the notifications.
   */
  subscribe(listener: () => void): () => void;
  /** Remembers a state (ignored unless it is one of the 32), or forgets it with null. */
  setState(code: string | null): void;
}

/** Snapshot for prerendering: the static export never knows a destination. */
export function getServerDestinationSnapshot(): string | null {
  return null;
}

function readCode(storage: Storage | null): string | null {
  try {
    const raw = storage?.getItem(STORAGE_KEY) ?? null;
    return raw !== null && KNOWN.has(raw) ? raw : null;
  } catch {
    return null;
  }
}

function createDestinationStore(
  storage: Storage | null,
  events: Pick<Window, 'addEventListener'> | null
): DestinationStore {
  let code = readCode(storage);
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };

  events?.addEventListener('storage', (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    code = readCode(storage);
    notify();
  });

  return {
    getSnapshot: () => code,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setState(next) {
      const valid = next !== null && KNOWN.has(next) ? next : null;
      if (valid === code) return;
      code = valid;
      try {
        if (valid === null) storage?.removeItem(STORAGE_KEY);
        else storage?.setItem(STORAGE_KEY, valid);
      } catch {
        // Quota or privacy mode: the choice lasts for this visit only.
      }
      notify();
    },
  };
}

let shared: DestinationStore | undefined;

function browserStorage(): Storage | null {
  try {
    return globalThis.window === undefined
      ? null
      : globalThis.window.localStorage;
  } catch {
    return null; // localStorage blocked by the browser
  }
}

/**
 * The delivery state of this browser tab, created on first use. Outside a browser it is an
 * in-memory store that starts empty.
 */
export function getDestinationStore(): DestinationStore {
  shared ??= createDestinationStore(
    browserStorage(),
    globalThis.window ?? null
  );
  return shared;
}
