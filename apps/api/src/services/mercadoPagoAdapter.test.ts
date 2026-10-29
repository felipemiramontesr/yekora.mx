import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createMercadoPagoAdapter,
  verifyMercadoPagoLiveAccount,
  verifyMercadoPagoTestAccount,
} from './mercadoPagoAdapter';
import { type SessionRequest } from './paymentPort';

// The 30-minute margin of FC 012 T2 (1 800 s).
const REMOTE_EXPIRY_MARGIN_MS = 30 * 60 * 1000;

const SECRETS = { accessToken: 'TEST-token', webhookSecret: 'mp-secret' };
const NOW = new Date('2026-10-21T19:00:00Z');
const MIN = 60 * 1000;

const request = (over: Partial<SessionRequest> = {}): SessionRequest => ({
  orderNumber: 'YEK-2026-ABCD1234',
  method: 'SPEI',
  totalMxnCents: 200050,
  description: 'Pedido YEK-2026-ABCD1234',
  expiresAt: new Date(NOW.getTime() + 24 * 60 * MIN),
  now: NOW,
  successUrl: 'https://yekora.mx/checkout/exito/',
  cancelUrl: 'https://yekora.mx/checkout/cancelado/',
  notificationUrl: 'https://apiv1.yekora.mx/v1/webhooks/mercadopago',
  ...over,
});

function answering(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify(body), { status })
  );
}

const sent = (fetchMock: ReturnType<typeof answering>) =>
  JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<
    string,
    unknown
  > & {
    payment_methods: { excluded_payment_types: { id: string }[] };
  };

describe('createSession (Checkout Pro preference, fixed host)', () => {
  it('posts a SPEI-only preference for the exact total to api.mercadopago.com', async () => {
    const fetchMock = answering({
      id: 'pref_1',
      init_point:
        'https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=pref_1',
    });
    const session = await createMercadoPagoAdapter(
      SECRETS,
      fetchMock
    ).createSession(request());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.mercadopago.com/checkout/preferences');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer TEST-token',
      'Content-Type': 'application/json',
    });
    const body = sent(fetchMock);
    expect(body).toMatchObject({
      items: [
        {
          id: 'YEK-2026-ABCD1234',
          title: 'Pedido YEK-2026-ABCD1234',
          quantity: 1,
          currency_id: 'MXN',
          unit_price: 2000.5, // 200 050 cents
        },
      ],
      external_reference: 'YEK-2026-ABCD1234',
      back_urls: {
        success: 'https://yekora.mx/checkout/exito/',
        pending: 'https://yekora.mx/checkout/exito/',
        failure: 'https://yekora.mx/checkout/cancelado/',
      },
      auto_return: 'approved',
      notification_url: 'https://apiv1.yekora.mx/v1/webhooks/mercadopago',
      expires: true,
      expiration_date_from: NOW.toISOString(),
    });
    // Only the chosen method stays offered (Ω, 112_AN).
    expect(
      body.payment_methods.excluded_payment_types.map((t) => t.id)
    ).not.toContain('bank_transfer');
    expect(body.payment_methods.excluded_payment_types).toHaveLength(7);
    expect(session).toEqual({
      reference: 'pref_1',
      redirectUrl:
        'https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=pref_1',
      remoteExpiresAt: new Date(NOW.getTime() + (24 * 60 - 30) * MIN),
    });
  });

  it('T2: preference and payment expire 30 min before the order hold', async () => {
    const fetchMock = answering({
      id: 'p',
      init_point: 'https://www.mercadopago.com.mx/x',
    });
    const expiresAt = new Date(NOW.getTime() + 60 * MIN);
    await createMercadoPagoAdapter(SECRETS, fetchMock).createSession(
      request({ method: 'MERCADO_PAGO_BALANCE', expiresAt })
    );
    const body = sent(fetchMock);
    for (const field of ['expiration_date_to', 'date_of_expiration']) {
      const remote = new Date(String(body[field])).getTime();
      expect(expiresAt.getTime() - remote).toBe(REMOTE_EXPIRY_MARGIN_MS);
    }
    expect(
      body.payment_methods.excluded_payment_types.map((t) => t.id)
    ).not.toContain('account_money');
  });

  it('refuses card and OXXO (they belong to Stripe) and a hold with no room left', async () => {
    for (const method of ['CARD', 'OXXO'] as const) {
      await expect(
        createMercadoPagoAdapter(SECRETS, answering({})).createSession(
          request({ method })
        )
      ).rejects.toThrow(`unsupported method ${method}`);
    }
    const fetchMock = answering({});
    await expect(
      createMercadoPagoAdapter(SECRETS, fetchMock).createSession(
        request({ expiresAt: new Date(NOW.getTime() + 30 * MIN) })
      )
    ).rejects.toThrow('the order hold is too short');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports an HTTP error or an unexpected answer without leaking the token', async () => {
    const error = await createMercadoPagoAdapter(SECRETS, answering({}, 400))
      .createSession(request())
      .catch((e: Error) => e);
    expect(error).toMatchObject({
      name: 'PaymentProcessorError',
      message: 'Mercado Pago: HTTP 400',
    });
    expect(String(error)).not.toContain('TEST-token');
    await expect(
      createMercadoPagoAdapter(SECRETS, answering({ id: 'p' })).createSession(
        request()
      )
    ).rejects.toThrow('unexpected preference answer');
  });
});

describe('verifyWebhook (manifest id;request-id;ts, constant time)', () => {
  const adapter = createMercadoPagoAdapter(SECRETS, answering({}));
  const body = Buffer.from(
    JSON.stringify({ id: 12345, type: 'payment', data: { id: '987' } })
  );
  const sign = (
    dataId: string,
    requestId: string,
    ts: string,
    secret = SECRETS.webhookSecret
  ) =>
    createHmac('sha256', secret)
      .update(`id:${dataId};request-id:${requestId};ts:${ts};`)
      .digest('hex');
  const verify = (
    raw: Buffer,
    headers: Record<string, string | string[] | undefined>,
    dataId: string | undefined = '987'
  ) =>
    adapter.verifyWebhook({
      rawBody: raw,
      headers,
      query: { 'data.id': dataId },
      now: NOW,
    });
  const ok = {
    'x-signature': `ts=1700,v1=${sign('987', 'req-1', '1700')}`,
    'x-request-id': 'req-1',
  };

  it('accepts a valid signature: the event id and the payment to reconcile', () => {
    expect(verify(body, ok)).toEqual({
      eventId: '12345',
      type: 'payment',
      resourceId: '987',
    });
  });

  it('lower-cases an alphanumeric data.id as the manifest requires, and takes array headers', () => {
    const headers = {
      'x-signature': [`ts=1700, v1=${sign('abc9', 'req-1', '1700')}`],
      'x-request-id': ['req-1'],
    };
    expect(verify(body, headers, 'ABC9')).toMatchObject({ resourceId: 'abc9' });
  });

  it('rejects another secret, another request id, another payment or missing parts', () => {
    expect(
      verify(body, {
        ...ok,
        'x-signature': `ts=1700,v1=${sign('987', 'req-1', '1700', 'x')}`,
      })
    ).toBeNull();
    expect(verify(body, { ...ok, 'x-request-id': 'req-2' })).toBeNull();
    expect(verify(body, ok, '988')).toBeNull();
    expect(verify(body, { ...ok, 'x-signature': 'v1=00' })).toBeNull();
    expect(verify(body, { 'x-signature': ok['x-signature'] })).toBeNull();
    expect(verify(body, ok, '')).toBeNull(); // no data.id in the query
    expect(verify(body, { ...ok, 'x-signature': 'ts=1700,v1=zz' })).toBeNull();
    expect(verify(body, {})).toBeNull();
  });

  it('rejects a signed delivery whose body is not JSON', () => {
    expect(verify(Buffer.from('nope'), ok)).toBeNull();
  });

  it('builds a stable event id when the body has none, and reads the type from the action', () => {
    const raw = Buffer.from(JSON.stringify({ action: 'payment.updated' }));
    expect(verify(raw, ok)).toEqual({
      eventId: 'payment.updated:987',
      type: 'payment.updated',
      resourceId: '987',
    });
    expect(verify(Buffer.from('{"id":"n-1"}'), ok)).toEqual({
      eventId: 'n-1',
      type: 'unknown',
      resourceId: '987',
    });
  });
});

describe('fetchPayment (reconciliation)', () => {
  it('reads the payment back: approved, amount in cents, currency, order number', async () => {
    const fetchMock = answering({
      status: 'approved',
      transaction_amount: 2000.5,
      currency_id: 'mxn',
      external_reference: 'YEK-2026-ABCD1234',
    });
    await expect(
      createMercadoPagoAdapter(SECRETS, fetchMock).fetchPayment('98/7')
    ).resolves.toEqual({
      paid: true,
      amountMxnCents: 200050,
      currency: 'MXN',
      orderNumber: 'YEK-2026-ABCD1234',
      processorStatus: 'approved',
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.mercadopago.com/v1/payments/98%2F7'
    );
  });

  it('treats anything but approved as not paid, and odd fields as missing', async () => {
    await expect(
      createMercadoPagoAdapter(
        SECRETS,
        answering({ status: 'pending', transaction_amount: Number.NaN })
      ).fetchPayment('1')
    ).resolves.toEqual({
      paid: false,
      amountMxnCents: null,
      currency: null,
      orderNumber: null,
      processorStatus: 'pending',
    });
    await expect(
      createMercadoPagoAdapter(
        SECRETS,
        answering({ transaction_amount: '10' })
      ).fetchPayment('1')
    ).resolves.toMatchObject({
      processorStatus: 'unknown',
      amountMxnCents: null,
    });
  });
});

describe('verifyWebhook without data.id in the query', () => {
  it('rejects a delivery whose query does not name the payment', () => {
    const adapter = createMercadoPagoAdapter(SECRETS, answering({}));
    expect(
      adapter.verifyWebhook({
        rawBody: Buffer.from('{}'),
        headers: { 'x-signature': 'ts=1,v1=00', 'x-request-id': 'r' },
        query: {},
        now: NOW,
      })
    ).toBeNull();
  });
});

describe('account check at startup (FC 019, GET /users/me)', () => {
  // The tags the client's test account returned (H 19:20:39); a real seller lacks test_user.
  const TEST_TAGS = { tags: ['user_product_seller', 'test_user', 'normal'] };
  const LIVE_TAGS = { tags: ['user_product_seller', 'normal'] };
  const TOKEN = 'APP_USR-secret-token';

  it('asks api.mercadopago.com/users/me with the token, and accepts a test account in sandbox', async () => {
    const fetchMock = answering(TEST_TAGS);
    await expect(
      verifyMercadoPagoTestAccount(TOKEN, fetchMock)
    ).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.mercadopago.com/users/me');
    expect(init?.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
  });

  it('accepts a real account in live', async () => {
    await expect(
      verifyMercadoPagoLiveAccount(TOKEN, answering(LIVE_TAGS))
    ).resolves.toBeUndefined();
  });

  const unreachable = vi.fn<typeof fetch>(async () => {
    throw new TypeError('fetch failed');
  });
  it.each([
    ['a real account', answering(LIVE_TAGS)],
    ['an HTTP error', answering({ message: 'invalid token' }, 401)],
    ['an answer without tags', answering({ id: 1 })],
    ['an unreachable Mercado Pago', unreachable],
  ])(
    'refuses %s in sandbox, without revealing the token',
    async (_case, fetchMock) => {
      const failure = verifyMercadoPagoTestAccount(TOKEN, fetchMock);
      await expect(failure).rejects.toThrow(/^UNVERIFIED_MP_TEST_ACCOUNT: /);
      await expect(failure).rejects.not.toThrow(TOKEN);
    }
  );

  it.each([
    ['a test account', answering(TEST_TAGS)],
    ['an HTTP error', answering({ message: 'invalid token' }, 401)],
    ['an answer without tags', answering({ id: 1 })],
    ['an unreachable Mercado Pago', unreachable],
  ])(
    'refuses %s in live, without revealing the token',
    async (_case, fetchMock) => {
      const failure = verifyMercadoPagoLiveAccount(TOKEN, fetchMock);
      await expect(failure).rejects.toThrow(/^TEST_ACCOUNT_REJECTED_IN_LIVE: /);
      await expect(failure).rejects.not.toThrow(TOKEN);
    }
  );
});
