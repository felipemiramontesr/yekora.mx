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
    itemsBaseMxnCents: 3000,
    itemsTaxMxnCents: 480,
    itemsTotalMxnCents: 3480,
    shippingCode: null,
    shippingBaseMxnCents: null,
    shippingTaxMxnCents: null,
    shippingTotalMxnCents: null,
    serviceable: true,
    freeShippingRemainingMxnCents: null,
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
      shippingIssue: null,
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
      shippingIssue: null,
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
      shippingIssue: null,
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
      shippingIssue: null,
    });
    await vi.advanceTimersByTimeAsync(300);
    expect(quoter.getSnapshot()).toEqual({
      status: 'error',
      quote: QUOTE,
      error: 'offline',
      shippingIssue: null,
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
      shippingIssue: null,
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
      shippingIssue: null,
    });
  });
});

describe('shipping to a delivery state (FC 011)', () => {
  const PROBLEM = (detail: string) => ({
    type: 'about:blank',
    title: 'Refused',
    status: 400,
    detail,
  });

  /** fetch answering a 400 with `detail` when a destination is sent, the quote otherwise. */
  const refusing = (detail: string) =>
    vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as {
          destination?: unknown;
        };
        return body.destination
          ? new Response(JSON.stringify(PROBLEM(detail)), { status: 400 })
          : new Response(JSON.stringify(QUOTE), { status: 200 });
      }
    );

  it('sends the state code with the lines, and nothing else', async () => {
    const fetchMock = answer(QUOTE);
    vi.stubGlobal('fetch', fetchMock);
    const quoter = createQuoter();
    quoter.request(LINES, 'es-MX', 'ZAC');
    await vi.advanceTimersByTimeAsync(300);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      items: LINES,
      destination: { stateCode: 'ZAC' },
    });
    expect(quoter.getSnapshot()).toMatchObject({
      status: 'ready',
      shippingIssue: null,
    });
  });

  it.each([
    ['EMPTY_OR_UNAVAILABLE_CART', 'cart_unavailable'],
    ['INVALID_DESTINATION', 'invalid_destination'],
  ])(
    'after a 400 %s it shows the products-only quote and says why',
    async (detail, issue) => {
      const fetchMock = refusing(detail);
      vi.stubGlobal('fetch', fetchMock);
      const quoter = createQuoter();
      quoter.request(LINES, 'es-MX', 'ZAC');
      await vi.advanceTimersByTimeAsync(300);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
        items: LINES,
      });
      expect(quoter.getSnapshot()).toEqual({
        status: 'ready',
        quote: QUOTE,
        error: null,
        shippingIssue: issue,
      });
    }
  );

  it('treats any other 400 with a state as a server error, without retrying', async () => {
    for (const body of [PROBLEM('SOMETHING_ELSE'), { detail: 7 }, 'not json']) {
      const fetchMock = answer(body, 400);
      vi.stubGlobal('fetch', fetchMock);
      const quoter = createQuoter();
      quoter.request(LINES, 'es-MX', 'ZAC');
      await vi.advanceTimersByTimeAsync(300);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(quoter.getSnapshot()).toMatchObject({
        status: 'error',
        error: 'server',
      });
    }
  });

  it('keeps a 400 without a state a plain server error', async () => {
    vi.stubGlobal('fetch', answer(PROBLEM('INVALID_DESTINATION'), 400));
    const quoter = await quoted();
    expect(quoter.getSnapshot()).toMatchObject({
      status: 'error',
      error: 'server',
    });
  });

  it('reports the fallback failing like any failed quote', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        return calls === 1
          ? new Response(JSON.stringify(PROBLEM('INVALID_DESTINATION')), {
              status: 400,
            })
          : new Response('{}', { status: 503 });
      })
    );
    const quoter = createQuoter();
    quoter.request(LINES, 'es-MX', 'ZAC');
    await vi.advanceTimersByTimeAsync(300);
    expect(quoter.getSnapshot()).toMatchObject({
      status: 'error',
      error: 'server',
    });
  });
});
