import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CartQuote } from '@/lib/cart/cartTypes';
import { createQuoter } from './cartClient';

const QUOTE: CartQuote = {
  items: [
    {
      sku: 'TENT',
      slug: 'tienda',
      name: 'Tienda',
      quantity: 3,
      unitPriceMxnCents: 1160,
      lineTotalMxnCents: 3480,
      lineBaseMxnCents: 3000,
      lineTaxMxnCents: 480,
      stockStatus: 'available',
      availableQuantity: 10,
      purchasable: true,
    },
  ],
  summary: {
    subtotalMxnCents: 3000,
    taxMxnCents: 480,
    totalMxnCents: 3480,
    totalItems: 3,
    referenceUsdCents: 188,
    exchangeRate: { series: 'SF43718', date: '2026-10-19', rate: '18.5000' },
  },
  warnings: [],
};
const LINES = [{ sku: 'TENT', quantity: 3 }];

const answer = (body: unknown, status = 200) =>
  vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async () =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
      })
  );

/** fetch that never answers until its request is aborted. */
const hanging = () =>
  vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('aborted'))
        );
      })
  );

/** Requests a quote and lets the debounce (300 ms) elapse. */
async function quoted(lines = LINES, locale: 'es-MX' | 'en' = 'es-MX') {
  const quoter = createQuoter();
  quoter.request(lines, locale);
  await vi.advanceTimersByTimeAsync(300);
  return quoter;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('quote requests', () => {
  it('posts SKUs and quantities only to the canonical endpoint and keeps the validated quote', async () => {
    const fetchMock = answer(QUOTE);
    vi.stubGlobal('fetch', fetchMock);
    const quoter = await quoted(LINES, 'en');
    expect(quoter.getSnapshot()).toEqual({
      status: 'ready',
      quote: QUOTE,
      error: null,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://apiv1.yekora.mx/v1/cart/quote?lang=en');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ items: LINES });
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it.each([
    ['a server error', answer({}, 503), 'server'],
    ['an answer outside the contract', answer({ items: 'x' }), 'invalid'],
    ['a body that is not JSON', answer('<html>proxy error</html>'), 'invalid'],
    [
      'totals that do not add up',
      answer({ ...QUOTE, summary: { ...QUOTE.summary, taxMxnCents: 1 } }),
      'invalid',
    ],
    [
      'a network failure',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
      'offline',
    ],
  ])('reports %s instead of throwing', async (_case, fetchMock, reason) => {
    vi.stubGlobal('fetch', fetchMock);
    const quoter = await quoted();
    expect(quoter.getSnapshot()).toEqual({
      status: 'error',
      quote: null,
      error: reason,
    });
  });

  it('does not even try while the browser is offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const fetchMock = answer(QUOTE);
    vi.stubGlobal('fetch', fetchMock);
    const quoter = await quoted();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(quoter.getSnapshot().error).toBe('offline');
  });

  it('gives up after 5 seconds', async () => {
    vi.stubGlobal('fetch', hanging());
    const quoter = await quoted();
    expect(quoter.getSnapshot().status).toBe('loading');
    await vi.advanceTimersByTimeAsync(5000);
    expect(quoter.getSnapshot()).toEqual({
      status: 'error',
      quote: null,
      error: 'timeout',
    });
  });
});

describe('createQuoter', () => {
  it('waits for the buyer to stop editing, then quotes once', async () => {
    const fetchMock = answer(QUOTE);
    vi.stubGlobal('fetch', fetchMock);
    const quoter = createQuoter();
    const listener = vi.fn();
    const stop = quoter.subscribe(listener);
    quoter.request(LINES, 'es-MX');
    quoter.request([{ sku: 'TENT', quantity: 4 }], 'es-MX');
    expect(quoter.getSnapshot().status).toBe('loading');
    await vi.advanceTimersByTimeAsync(300);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      items: [{ sku: 'TENT', quantity: 4 }],
    });
    expect(quoter.getSnapshot().status).toBe('ready');
    expect(listener).toHaveBeenCalled();
    stop();
  });

  it('keeps the last good quote when a re-quote fails', async () => {
    vi.stubGlobal('fetch', answer(QUOTE));
    const quoter = await quoted();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );
    quoter.request(LINES, 'es-MX');
    expect(quoter.getSnapshot()).toEqual({
      status: 'loading',
      quote: QUOTE,
      error: null,
    });
    await vi.advanceTimersByTimeAsync(300);
    expect(quoter.getSnapshot()).toEqual({
      status: 'error',
      quote: QUOTE,
      error: 'offline',
    });
  });

  it('cancels a request that a newer edit replaced and ignores its answer', async () => {
    const slow = hanging();
    vi.stubGlobal('fetch', slow);
    const quoter = await quoted();
    vi.stubGlobal('fetch', answer(QUOTE));
    quoter.request([{ sku: 'TENT', quantity: 5 }], 'es-MX');
    expect(slow.mock.calls[0][1]?.signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    expect(quoter.getSnapshot()).toEqual({
      status: 'ready',
      quote: QUOTE,
      error: null,
    });
  });

  it('clears the quote for an empty cart without asking the API', async () => {
    const fetchMock = answer(QUOTE);
    vi.stubGlobal('fetch', fetchMock);
    const quoter = await quoted([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(quoter.getSnapshot()).toEqual({
      status: 'idle',
      quote: null,
      error: null,
    });
  });
});
