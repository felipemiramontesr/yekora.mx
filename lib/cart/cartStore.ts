/**
 * Guest cart store (FC 009 F2, ADR 0008): SKUs and quantities in `localStorage`, nothing else.
 *
 * Shaped for React's `useSyncExternalStore`: `getSnapshot` returns the same frozen array until
 * the cart changes, and `subscribe` notifies on every change, including changes made in other
 * tabs (the `storage` event). Storage is best effort: private browsing, a full quota or a
 * blocked origin leave a working in-memory cart instead of an error, and a corrupt or tampered
 * value is ignored rather than trusted (it is validated with the same contract as the API).
 *
 * @module
 */
import {
  CART_STORAGE_KEY,
  cartLinesSchema,
  MAX_LINES,
  MAX_QUANTITY,
  type CartLine,
} from './cartTypes';

/** The cart as the UI uses it. */
interface CartStore {
  /** Current lines; the same array until something changes. */
  getSnapshot(): readonly CartLine[];
  /**
   * Calls `listener` after every change.
   *
   * @returns A function that stops the notifications.
   */
  subscribe(listener: () => void): () => void;
  /**
   * Adds units of a product, merging with its line and capping at 99.
   *
   * @returns False when nothing changed: invalid SKU, cart full (50 lines) or already at 99.
   */
  addItem(sku: string, quantity?: number): boolean;
  /** Removes a product's line. */
  removeItem(sku: string): void;
  /** Sets a line's quantity (capped at 99); 0 or less removes the line. */
  updateQuantity(sku: string, quantity: number): void;
  /** Empties the cart. */
  clearCart(): void;
}

const EMPTY: readonly CartLine[] = Object.freeze([]);

/** Snapshot for prerendering: the static export never has a cart. */
export function getServerCartSnapshot(): readonly CartLine[] {
  return EMPTY;
}

function readLines(storage: Storage | null): readonly CartLine[] {
  try {
    const raw = storage?.getItem(CART_STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = cartLinesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? Object.freeze(parsed.data) : EMPTY;
  } catch {
    return EMPTY;
  }
}

// NaN and Infinity are not quantities; fractions are floored by clampQuantity.
function isQuantity(quantity: number): boolean {
  return Number.isFinite(quantity) && quantity >= 1;
}

function clampQuantity(quantity: number): number {
  return Math.min(Math.floor(quantity), MAX_QUANTITY);
}

function createCartStore(
  storage: Storage | null,
  events: Pick<Window, 'addEventListener'> | null
): CartStore {
  let lines = readLines(storage);
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };
  const commit = (next: CartLine[]) => {
    lines = next.length === 0 ? EMPTY : Object.freeze(next);
    try {
      if (next.length === 0) storage?.removeItem(CART_STORAGE_KEY);
      else storage?.setItem(CART_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Quota or privacy mode: the cart keeps working in memory for this visit.
    }
    notify();
  };

  // Another tab changed (or cleared) the cart: adopt its value.
  events?.addEventListener('storage', (event: StorageEvent) => {
    if (event.key !== CART_STORAGE_KEY && event.key !== null) return;
    lines = readLines(storage);
    notify();
  });

  return {
    getSnapshot: () => lines,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    addItem(sku, quantity = 1) {
      if (sku.length === 0 || sku.length > 64 || !isQuantity(quantity))
        return false;
      const current = lines.find((line) => line.sku === sku);
      if (!current) {
        if (lines.length >= MAX_LINES) return false;
        commit([...lines, { sku, quantity: clampQuantity(quantity) }]);
        return true;
      }
      const next = clampQuantity(current.quantity + quantity);
      if (next === current.quantity) return false;
      commit(
        lines.map((line) => (line.sku === sku ? { sku, quantity: next } : line))
      );
      return true;
    },
    removeItem(sku) {
      if (!lines.some((line) => line.sku === sku)) return;
      commit(lines.filter((line) => line.sku !== sku));
    },
    updateQuantity(sku, quantity) {
      const current = lines.find((line) => line.sku === sku);
      // A garbled value (NaN, Infinity) never edits the cart; 0 or less removes the line.
      if (!current || !Number.isFinite(quantity)) return;
      if (!isQuantity(quantity)) {
        commit(lines.filter((line) => line.sku !== sku));
        return;
      }
      const next = clampQuantity(quantity);
      if (next === current.quantity) return;
      commit(
        lines.map((line) => (line.sku === sku ? { sku, quantity: next } : line))
      );
    },
    clearCart() {
      if (lines.length > 0) commit([]);
    },
  };
}

let shared: CartStore | undefined;

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
 * The cart of this browser tab, created on first use. Outside a browser (prerendering) it is an
 * in-memory, always-empty cart.
 */
export function getCartStore(): CartStore {
  shared ??= createCartStore(browserStorage(), globalThis.window ?? null);
  return shared;
}
