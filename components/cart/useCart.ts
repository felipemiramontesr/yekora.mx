'use client';

/**
 * React bindings of the guest cart (FC 009 F3): the cart lines, its live quote, and the
 * request to open the cart panel from anywhere (the add-to-pack button lives in the product
 * page, the panel in the header).
 *
 * @module
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Locale } from '@/app/i18n';
import { createQuoter, type QuoteState } from '@/lib/api/cartClient';
import type { CartLine } from '@/lib/cart/cartTypes';
import { getCartStore, getServerCartSnapshot } from '@/lib/cart/cartStore';
import {
  getDestinationStore,
  getServerDestinationSnapshot,
} from '@/lib/cart/destinationStore';

/** Window event that asks the header's cart panel to open. */
const OPEN_EVENT = 'yekora:cart-open';

/**
 * The cart lines of this tab, kept in sync with storage and other tabs. Prerendered pages see
 * an empty cart, then hydrate with the stored one.
 */
export function useCartLines(): readonly CartLine[] {
  const store = getCartStore();
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    getServerCartSnapshot
  );
}

/**
 * The delivery state the buyer chose (FC 011), remembered between visits and shared by every
 * tab, with the function that changes it. Prerendered pages see none.
 *
 * @returns The state code (or null) and its setter.
 */
export function useDeliveryState(): [
  string | null,
  (code: string | null) => void,
] {
  const store = getDestinationStore();
  const code = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    getServerDestinationSnapshot
  );
  return [code, store.setState];
}

/**
 * Live quote of the given lines: re-quoted after edits (debounced), keeping the last good
 * quote while updating or after a failure. With a delivery state it also prices shipping.
 *
 * @param lines - Current cart lines.
 * @param locale - Language of the product names.
 * @param stateCode - Delivery state, or null for products only.
 * @param revision - Bump it to re-quote unchanged lines (the checkout does after a 409).
 */
export function useCartQuote(
  lines: readonly CartLine[],
  locale: Locale,
  stateCode: string | null = null,
  revision = 0
): QuoteState {
  const [quoter] = useState(createQuoter);
  const state = useSyncExternalStore(
    quoter.subscribe,
    quoter.getSnapshot,
    quoter.getSnapshot
  );
  useEffect(() => {
    quoter.request(lines, locale, stateCode);
  }, [quoter, lines, locale, stateCode, revision]);
  return state;
}

/** Asks the cart panel to open (after adding a product). */
export function openCartPanel(): void {
  globalThis.dispatchEvent(new Event(OPEN_EVENT));
}

/**
 * Runs `onOpen` whenever something asks the cart panel to open.
 *
 * @param onOpen - Stable callback that opens the panel.
 */
export function useCartPanelRequests(onOpen: () => void): void {
  useEffect(() => {
    globalThis.addEventListener(OPEN_EVENT, onOpen);
    return () => globalThis.removeEventListener(OPEN_EVENT, onOpen);
  }, [onOpen]);
}
