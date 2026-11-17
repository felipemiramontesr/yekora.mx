import { describe, expect, it, vi } from 'vitest';
import {
  detachPaymentMethod,
  listPaymentMethods,
  startPaymentMethodSetup,
} from './paymentMethodsClient';

const CARD = {
  id: 'pm_1Abcdefgh12345',
  brand: 'visa',
  last4: '4242',
  expMonth: 12,
  expYear: 2031,
};

/** A fetch that answers once with `status` and `body`. */
const answering = (status: number, body: unknown) =>
  vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
  );

const headersOf = (fetchImpl: ReturnType<typeof answering>) =>
  fetchImpl.mock.calls[0][1]?.headers as Record<string, string>;

describe('saved cards client (FC 054 F1)', () => {
  it('lists the cards with the session cookie and no Idempotency-Key', async () => {
    const fetchImpl = answering(200, { items: [CARD], hasCustomer: true });
    await expect(listPaymentMethods(fetchImpl)).resolves.toEqual({
      ok: true,
      data: { items: [CARD], hasCustomer: true },
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://apiv1.yekora.mx/v1/account/payment-methods');
    expect(init?.credentials).toBe('include');
    expect(headersOf(fetchImpl)).not.toHaveProperty('Idempotency-Key');
  });

  it('opens the hosted page under a fresh Idempotency-Key, in the language of the page', async () => {
    const fetchImpl = answering(201, {
      redirectUrl: 'https://checkout.stripe.com/c/pay/cs_test_1',
    });
    await expect(startPaymentMethodSetup('en', fetchImpl)).resolves.toEqual({
      ok: true,
      data: { redirectUrl: 'https://checkout.stripe.com/c/pay/cs_test_1' },
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      'https://apiv1.yekora.mx/v1/account/payment-methods/setup?lang=en'
    );
    expect(init?.method).toBe('POST');
    expect(headersOf(fetchImpl)['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('detaches one card by its id', async () => {
    const fetchImpl = answering(200, { detached: true });
    await expect(detachPaymentMethod(CARD.id, fetchImpl)).resolves.toEqual({
      ok: true,
      data: { detached: true },
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      `https://apiv1.yekora.mx/v1/account/payment-methods/${CARD.id}`
    );
    expect(init?.method).toBe('DELETE');
    expect(headersOf(fetchImpl)).toHaveProperty('Idempotency-Key');
  });

  it('names the refusals the page explains and keeps the rest as unknown', async () => {
    await expect(
      detachPaymentMethod(
        CARD.id,
        answering(404, { detail: 'PAYMENT_METHOD_NOT_FOUND' })
      )
    ).resolves.toEqual({ ok: false, reason: 'PAYMENT_METHOD_NOT_FOUND' });
    await expect(
      listPaymentMethods(answering(503, { detail: 'SERVICE_UNAVAILABLE' }))
    ).resolves.toEqual({ ok: false, reason: 'SERVICE_UNAVAILABLE' });
    await expect(
      listPaymentMethods(
        answering(401, { detail: 'SESSION_INVALID_OR_EXPIRED' })
      )
    ).resolves.toEqual({ ok: false, reason: 'SESSION_INVALID_OR_EXPIRED' });
    await expect(
      listPaymentMethods(answering(429, { detail: 'whatever' }))
    ).resolves.toEqual({ ok: false, reason: 'rate_limited' });
    await expect(
      listPaymentMethods(answering(400, { detail: 'SOMETHING_NEW' }))
    ).resolves.toEqual({ ok: false, reason: 'unknown' });
  });

  it('refuses an answer outside the contract and never throws offline', async () => {
    await expect(
      listPaymentMethods(
        answering(200, { items: [{ ...CARD, last4: '42' }], hasCustomer: true })
      )
    ).resolves.toEqual({ ok: false, reason: 'invalid' });
    const offline = vi.fn<typeof fetch>(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(listPaymentMethods(offline)).resolves.toEqual({
      ok: false,
      reason: 'offline',
    });
  });
});
