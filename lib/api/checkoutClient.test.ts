import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CheckoutRequest } from '@/lib/checkout/checkoutTypes';
import { fetchOrder, submitCheckout } from './checkoutClient';

const REQUEST = { method: 'CARD' } as unknown as CheckoutRequest;
const SESSION = {
  orderNumber: 'YEK-2026-AB12CD34',
  accessToken: 'a'.repeat(43),
  redirectUrl: 'https://checkout.stripe.com/c/pay/x',
  expiresAt: '2026-10-21T20:00:00.000Z',
  totalMxnCents: 200000,
};
const ORDER = {
  orderNumber: 'YEK-2026-AB12CD34',
  status: 'PENDING_PAYMENT',
  method: 'OXXO',
  itemsTotalMxnCents: 185000,
  shippingTotalMxnCents: 15000,
  totalMxnCents: 200000,
  expiresAt: '2026-10-24T19:00:00.000Z',
  paidAt: null,
};
const ACCESS = { orderNumber: ORDER.orderNumber, accessToken: 'k'.repeat(43) };

const answer = (status: number, body?: unknown) =>
  vi.fn(async () =>
    body === undefined
      ? new Response('not json', { status })
      : Response.json(body, { status })
  );

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('submitCheckout', () => {
  it('posts the request to /v1/checkout in the page language and returns the session', async () => {
    const fetchImpl = answer(201, SESSION);
    await expect(submitCheckout(REQUEST, 'en', { fetchImpl })).resolves.toEqual(
      { ok: true, session: SESSION }
    );
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://apiv1.yekora.mx/v1/checkout?lang=en');
    expect(init).toMatchObject({
      method: 'POST',
      body: JSON.stringify(REQUEST),
      headers: { 'Content-Type': 'application/json' },
    });
  });

  it.each([
    'SERVICE_UNAVAILABLE',
    'INVALID_REQUEST',
    'INVALID_SHIPPING_ADDRESS',
    'PRIVACY_CONSENT_REQUIRED',
    'EMPTY_OR_UNAVAILABLE_CART',
    'UNSERVICEABLE_DESTINATION',
    'PRICE_CHANGED',
    'INSUFFICIENT_STOCK',
  ])('reports the refusal %s by its code', async (code) => {
    const fetchImpl = answer(code === 'PRICE_CHANGED' ? 409 : 400, {
      status: 400,
      detail: code,
    });
    await expect(
      submitCheckout(REQUEST, 'es-MX', { fetchImpl })
    ).resolves.toEqual({ ok: false, reason: code });
  });

  it.each([
    ['an unknown code', answer(400, { detail: 'SOMETHING_NEW' }), 'server'],
    ['a problem without detail', answer(429, { status: 429 }), 'server'],
    ['a body that is not JSON', answer(502), 'server'],
    ['a 201 outside the contract', answer(201, { orderNumber: 1 }), 'invalid'],
    ['a 201 that is not JSON', answer(201), 'invalid'],
  ])('reports %s as %s', async (_case, fetchImpl, reason) => {
    await expect(
      submitCheckout(REQUEST, 'es-MX', { fetchImpl })
    ).resolves.toEqual({ ok: false, reason });
  });

  it('does not call the network while offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const fetchImpl = answer(201, SESSION);
    await expect(
      submitCheckout(REQUEST, 'es-MX', { fetchImpl })
    ).resolves.toEqual({ ok: false, reason: 'offline' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports a lost connection as offline', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(
      submitCheckout(REQUEST, 'es-MX', { fetchImpl })
    ).resolves.toEqual({ ok: false, reason: 'offline' });
  });

  it('gives up after 20 s as a timeout', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          );
        })
    );
    const pending = submitCheckout(REQUEST, 'es-MX', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(fetchImpl.mock.calls[0][1].signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ ok: false, reason: 'timeout' });
  });
});

describe('fetchOrder', () => {
  it('reads the order with its token in Authorization, never in the URL', async () => {
    const fetchImpl = answer(200, ORDER);
    await expect(fetchOrder(ACCESS, { fetchImpl })).resolves.toEqual({
      ok: true,
      order: ORDER,
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://apiv1.yekora.mx/v1/orders/YEK-2026-AB12CD34');
    expect(url).not.toContain(ACCESS.accessToken);
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${ACCESS.accessToken}`,
    });
  });

  it.each([
    [
      'a 404 (unknown order or wrong token)',
      answer(404, { status: 404 }),
      'not_found',
    ],
    ['a 503', answer(503, { status: 503 }), 'server'],
    [
      'an answer outside the contract',
      answer(200, { ...ORDER, status: 'SHIPPED' }),
      'invalid',
    ],
    ['an answer that is not JSON', answer(200), 'invalid'],
  ])('reports %s', async (_case, fetchImpl, reason) => {
    await expect(fetchOrder(ACCESS, { fetchImpl })).resolves.toEqual({
      ok: false,
      reason,
    });
  });

  it('reports a lost connection as offline', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(fetchOrder(ACCESS, { fetchImpl })).resolves.toEqual({
      ok: false,
      reason: 'offline',
    });
  });

  it('uses the browser fetch by default', async () => {
    const fetchImpl = answer(200, ORDER);
    vi.stubGlobal('fetch', fetchImpl);
    await expect(fetchOrder(ACCESS)).resolves.toMatchObject({ ok: true });
    await submitCheckout(REQUEST, 'es-MX');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
