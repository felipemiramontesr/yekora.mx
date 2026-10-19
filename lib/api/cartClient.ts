/**
 * Cart quote client (FC 009 F2): the browser asks `POST /v1/cart/quote` for amounts.
 *
 * It never throws: offline, a 5 s timeout, a server error or an answer outside the contract
 * all become a typed failure, so the cart can say what happened and keep showing the last good
 * quote instead of breaking. A quoter on top debounces re-quotes while the buyer edits the
 * cart and drops answers that a newer edit has superseded. The browser calls apiv1 directly
 * (CSP `connect-src` allows it); the service worker never sees this POST (sw.js: same-origin
 * GET only).
 *
 * @module
 */
import type { Locale } from '@/app/i18n';
import {
  cartQuoteSchema,
  type CartLine,
  type CartQuote,
} from '@/lib/cart/cartTypes';

/** The canonical quote endpoint. E2E tests intercept it; they never reach production. */
const QUOTE_URL = 'https://apiv1.yekora.mx/v1/cart/quote';
/** Budget of one quote request (FC 009). */
const TIMEOUT_MS = 5000;
/** Pause after the last edit before re-quoting. */
const DEBOUNCE_MS = 300;

/** Why a quote could not be obtained. */
type QuoteFailure = 'offline' | 'timeout' | 'server' | 'invalid' | 'aborted';

/** Outcome of one quote request. */
type QuoteResult =
  { ok: true; quote: CartQuote } | { ok: false; reason: QuoteFailure };

/** Options of {@link fetchCartQuote}. */
interface FetchOptions {
  /** `fetch`, injectable for tests. */
  fetchImpl?: typeof fetch;
  /** Abort after this many milliseconds. */
  timeoutMs?: number;
  /** Cancels the request when a newer one replaces it. */
  signal?: AbortSignal;
}

/**
 * Asks the API to quote a cart (used by {@link createQuoter}).
 *
 * @param lines - Cart lines (SKUs and quantities only).
 * @param locale - Language of the product names in the answer.
 * @param options - Injectable fetch, timeout and cancellation.
 * @returns The validated quote, or why there is none. Never rejects.
 */
async function fetchCartQuote(
  lines: readonly CartLine[],
  locale: Locale,
  options: FetchOptions = {}
): Promise<QuoteResult> {
  const { fetchImpl = fetch, timeoutMs = TIMEOUT_MS, signal } = options;
  if (globalThis.navigator?.onLine === false) {
    return { ok: false, reason: 'offline' };
  }
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel);
  // Only the network or an abort can reject here; the answer itself is classified by send().
  const result = await send(fetchImpl, lines, locale, controller.signal).catch(
    (): QuoteResult => {
      if (timedOut) return { ok: false, reason: 'timeout' };
      if (signal?.aborted) return { ok: false, reason: 'aborted' };
      return { ok: false, reason: 'offline' };
    }
  );
  clearTimeout(timer);
  signal?.removeEventListener('abort', cancel);
  return result;
}

async function send(
  fetchImpl: typeof fetch,
  lines: readonly CartLine[],
  locale: Locale,
  signal: AbortSignal
): Promise<QuoteResult> {
  const answer = await fetchImpl(`${QUOTE_URL}?lang=${locale}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ items: lines }),
    signal,
  });
  if (!answer.ok) return { ok: false, reason: 'server' };
  // A body that is not JSON is an invalid answer, not a lost connection.
  const body: unknown = await answer.json().catch(() => undefined);
  const parsed = cartQuoteSchema.safeParse(body);
  return parsed.success
    ? { ok: true, quote: parsed.data }
    : { ok: false, reason: 'invalid' };
}

/** What the cart UI shows about the quote. */
export interface QuoteState {
  /** `idle` with an empty cart; `loading` while a re-quote is pending. */
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** Last good quote; kept while loading or after a failure. */
  quote: CartQuote | null;
  /** Why the latest attempt failed, or null. */
  error: Exclude<QuoteFailure, 'aborted'> | null;
}

/** A debounced quote source for the UI, shaped for `useSyncExternalStore`. */
interface Quoter {
  /** Current state; the same object until it changes. */
  getSnapshot(): QuoteState;
  /**
   * Calls `listener` after every state change.
   *
   * @returns A function that stops the notifications.
   */
  subscribe(listener: () => void): () => void;
  /** Re-quotes these lines after a short pause; an empty cart clears the quote. */
  request(lines: readonly CartLine[], locale: Locale): void;
}

/**
 * Creates the quoter of a cart view.
 *
 * @param fetchQuote - Quote request, injectable for tests.
 * @param delayMs - Debounce after the last edit.
 */
export function createQuoter(
  fetchQuote: typeof fetchCartQuote = fetchCartQuote,
  delayMs: number = DEBOUNCE_MS
): Quoter {
  let state: QuoteState = { status: 'idle', quote: null, error: null };
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: AbortController | undefined;

  const set = (next: QuoteState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    request(lines, locale) {
      clearTimeout(timer);
      inFlight?.abort();
      if (lines.length === 0) {
        set({ status: 'idle', quote: null, error: null });
        return;
      }
      set({ ...state, status: 'loading' });
      timer = setTimeout(() => {
        const controller = new AbortController();
        inFlight = controller;
        void fetchQuote(lines, locale, { signal: controller.signal }).then(
          (result) => {
            // A newer edit replaced this request: its answer is stale.
            if (controller.signal.aborted) return;
            if (result.ok)
              set({ status: 'ready', quote: result.quote, error: null });
            else
              set({
                ...state,
                status: 'error',
                error: result.reason as QuoteState['error'],
              });
          }
        );
      }, delayMs);
    },
  };
}
