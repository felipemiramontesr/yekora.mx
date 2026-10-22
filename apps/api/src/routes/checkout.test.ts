import type { FastifyInstance } from 'fastify';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { createCheckout } from '../services/checkout';
import type { Db, Transactional } from '../services/db';

// The truth tables are proven in services/checkout.test.ts; here only the HTTP mapping is.
vi.mock('../services/checkout', async (original) => ({
  ...(await original<typeof import('../services/checkout')>()),
  createCheckout: vi.fn(),
}));
const outcome = vi.mocked(createCheckout);
type CheckoutOutcome = Awaited<ReturnType<typeof createCheckout>>;

const config = loadConfig({
  DB_HOST: '127.0.0.1',
  DB_USER: 'root',
  DB_NAME: 'yekora_dev',
});

const db: Db & Transactional = {
  query: async <Row>() => [] as Row[],
  ping: async () => undefined,
  transaction(work) {
    return work(this);
  },
  close: async () => undefined,
};

const SESSION = {
  orderNumber: 'YEK-2026-AB12CD34',
  accessToken: 'a'.repeat(43),
  redirectUrl: 'https://checkout.stripe.com/c/pay/x',
  expiresAt: '2026-10-21T20:00:00.000Z',
  totalMxnCents: 200000,
};

let app: FastifyInstance;

async function makeApp() {
  app = await buildApp({ config, db, rate: async () => null, logger: false });
  return app;
}

function checkout(payload: unknown = { method: 'CARD' }, url = '/v1/checkout') {
  return app.inject({ method: 'POST', url, payload: payload as object });
}

// Same cold-start budget as app.test.ts.
beforeAll(async () => {
  await (await makeApp()).inject('/health');
  await app.close();
}, 30_000);

afterEach(async () => {
  outcome.mockReset();
  await app.close();
});

describe('POST /v1/checkout', () => {
  it('answers 201 with the session and passes the body and language through', async () => {
    outcome.mockResolvedValue({ ok: true, session: SESSION });
    await makeApp();
    const res = await checkout({ method: 'SPEI' }, '/v1/checkout?lang=en');
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual(SESSION);
    expect(outcome).toHaveBeenCalledWith(
      expect.objectContaining({ db, payments: config.payments }),
      { method: 'SPEI' },
      'en'
    );
  });

  it('defaults to Spanish return pages', async () => {
    outcome.mockResolvedValue({ ok: true, session: SESSION });
    await makeApp();
    await checkout();
    expect(outcome.mock.calls[0][2]).toBe('es-MX');
  });

  it.each([
    [503, 'SERVICE_UNAVAILABLE', 'Payments unavailable'],
    [400, 'INVALID_REQUEST', 'Invalid checkout request'],
    [400, 'INVALID_SHIPPING_ADDRESS', 'Invalid shipping address'],
    [400, 'PRIVACY_CONSENT_REQUIRED', 'Privacy consent required'],
    [400, 'EMPTY_OR_UNAVAILABLE_CART', 'Cart cannot be quoted'],
    [400, 'UNSERVICEABLE_DESTINATION', 'Destination not served'],
    [409, 'PRICE_CHANGED', 'Prices changed'],
    [409, 'INSUFFICIENT_STOCK', 'Insufficient stock'],
  ] as const)(
    'maps %i %s to a problem whose detail is the code',
    async (status, code, title) => {
      outcome.mockResolvedValue({ ok: false, status, code } as CheckoutOutcome);
      await makeApp();
      const res = await checkout();
      expect(res.statusCode).toBe(status);
      expect(res.headers['content-type']).toMatch(
        /^application\/problem\+json/
      );
      expect(res.json()).toEqual({
        type: 'about:blank',
        title,
        status,
        detail: code,
      });
    }
  );

  it('refuses an unknown language before running the checkout', async () => {
    await makeApp();
    const res = await checkout(undefined, '/v1/checkout?lang=fr');
    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toBe('INVALID_REQUEST');
    expect(outcome).not.toHaveBeenCalled();
  });

  it('refuses a body over 16 KB with 413', async () => {
    await makeApp();
    const res = await checkout({ method: 'CARD', pad: 'x'.repeat(17 * 1024) });
    expect(res.statusCode).toBe(413);
    expect(outcome).not.toHaveBeenCalled();
  });

  it('allows 10 attempts per minute per address, then 429', async () => {
    outcome.mockResolvedValue({
      ok: false,
      status: 409,
      code: 'PRICE_CHANGED',
    });
    await makeApp();
    const codes: number[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      codes.push((await checkout()).statusCode);
    }
    expect(codes).toEqual([...Array(10).fill(409), 429]);
  });
});
