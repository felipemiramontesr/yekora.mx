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
 * FC 011: with a delivery state the same request also prices shipping. When the API refuses
 * that (a line cannot be bought now, or the state is unknown: T1.1, HTTP 400), the quoter asks
 * again without the state, so the cart still shows its lines and their warnings, and reports
 * why shipping is missing instead of failing the whole cart.
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

/** Why shipping could not be priced (the 400 problems of T1.1, FC 011). */
type ShippingIssue = 'cart_unavailable' | 'invalid_destination';

/** Why a quote could not be obtained. */
type QuoteFailure =
  'offline' | 'timeout' | 'server' | 'invalid' | 'aborted' | ShippingIssue;

/** Machine code of the API's 400 problems, as sent in `detail`. */
const SHIPPING_ISSUES: Record<string, ShippingIssue> = {
  EMPTY_OR_UNAVAILABLE_CART: 'cart_unavailable',
  INVALID_DESTINATION: 'invalid_destination',
};

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
  /** Delivery state (ISO 3166-2:MX code) to price shipping to; omitted for products only. */
  stateCode?: string;
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
  const {
    fetchImpl = fetch,
    timeoutMs = TIMEOUT_MS,
    signal,
    stateCode,
  } = options;
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
  const result = await send(
    fetchImpl,
    lines,
    locale,
    controller.signal,
    stateCode
  ).catch((): QuoteResult => {
    if (timedOut) return { ok: false, reason: 'timeout' };
    if (signal?.aborted) return { ok: false, reason: 'aborted' };
    return { ok: false, reason: 'offline' };
  });
  clearTimeout(timer);
  signal?.removeEventListener('abort', cancel);
  return result;
}

async function send(
  fetchImpl: typeof fetch,
  lines: readonly CartLine[],
  locale: Locale,
  signal: AbortSignal,
  stateCode: string | undefined
): Promise<QuoteResult> {
  const answer = await fetchImpl(`${QUOTE_URL}?lang=${locale}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(
      stateCode === undefined
        ? { items: lines }
        : { items: lines, destination: { stateCode } }
    ),
    signal,
  });
  if (answer.status === 400 && stateCode !== undefined) {
    const problem: unknown = await answer.json().catch(() => undefined);
    const detail = (problem as { detail?: unknown } | undefined)?.detail;
    const issue =
      typeof detail === 'string' ? SHIPPING_ISSUES[detail] : undefined;
    return { ok: false, reason: issue ?? 'server' };
  }
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
  error: Exclude<QuoteFailure, 'aborted' | ShippingIssue> | null;
  /** Why the quote has no shipping although a state was chosen, or null. */
  shippingIssue: ShippingIssue | null;
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
  /**
   * Re-quotes these lines after a short pause, with shipping to `stateCode` when given; an
   * empty cart clears the quote.
   */
  request(
    lines: readonly CartLine[],
    locale: Locale,
    stateCode?: string | null
  ): void;
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
  let state: QuoteState = {
    status: 'idle',
    quote: null,
    error: null,
    shippingIssue: null,
  };
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
    request(lines, locale, stateCode = null) {
      clearTimeout(timer);
      inFlight?.abort();
      if (lines.length === 0) {
        set({ status: 'idle', quote: null, error: null, shippingIssue: null });
        return;
      }
      set({ ...state, status: 'loading' });
      timer = setTimeout(() => {
        const controller = new AbortController();
        inFlight = controller;
        void quoteWithFallback(controller.signal, stateCode ?? undefined).then(
          ({ result, issue }) => {
            // A newer edit replaced this request: its answer is stale.
            if (controller.signal.aborted) return;
            if (result.ok)
              set({
                status: 'ready',
                quote: result.quote,
                error: null,
                shippingIssue: issue,
              });
            else
              set({
                ...state,
                status: 'error',
                error: result.reason as QuoteState['error'],
              });
          }
        );
      }, delayMs);

      // With a state, a T1.1 refusal falls back to the products-only quote.
      async function quoteWithFallback(
        signal: AbortSignal,
        state?: string
      ): Promise<{ result: QuoteResult; issue: ShippingIssue | null }> {
        const first = await fetchQuote(lines, locale, {
          signal,
          stateCode: state,
        });
        if (
          first.ok ||
          (first.reason !== 'cart_unavailable' &&
            first.reason !== 'invalid_destination')
        ) {
          return { result: first, issue: null };
        }
        return {
          result: await fetchQuote(lines, locale, { signal }),
          issue: first.reason,
        };
      }
    },
  };
}
