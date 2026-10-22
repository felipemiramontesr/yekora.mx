import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { type SessionRequest } from './paymentPort';
import { createStripeAdapter } from './stripeAdapter';

// The 30-minute margin of FC 012 T2 (1 800 s).
const REMOTE_EXPIRY_MARGIN_MS = 30 * 60 * 1000;

const SECRETS = { apiKey: 'sk_test_key', webhookSecret: 'whsec_test' };
// 2026-10-21 13:00 in Mexico City (UTC−6).
const NOW = new Date('2026-10-21T19:00:00Z');
const MIN = 60 * 1000;

const request = (over: Partial<SessionRequest> = {}): SessionRequest => ({
  orderNumber: 'YEK-2026-ABCD1234',
  method: 'CARD',
  totalMxnCents: 200000,
  description: 'Pedido YEK-2026-ABCD1234',
  expiresAt: new Date(NOW.getTime() + 60 * MIN),
  now: NOW,
  successUrl: 'https://yekora.mx/checkout/exito/',
  cancelUrl: 'https://yekora.mx/checkout/cancelado/',
  notificationUrl: 'https://apiv1.yekora.mx/v1/webhooks/stripe',
  ...over,
});

function answering(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify(body), { status })
  );
}

const sentForm = (fetchMock: ReturnType<typeof answering>) =>
  new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body));

describe('createSession (Checkout Session, fixed host)', () => {
  it('posts a card session for the exact total to api.stripe.com with the secret key', async () => {
    const fetchMock = answering({
      id: 'cs_test_1',
      url: 'https://checkout.stripe.com/c/pay/cs_test_1',
    });
    const session = await createStripeAdapter(SECRETS, fetchMock).createSession(
      request()
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer sk_test_key',
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    const form = sentForm(fetchMock);
    expect(Object.fromEntries(form)).toMatchObject({
      mode: 'payment',
      'payment_method_types[0]': 'card',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'mxn',
      'line_items[0][price_data][unit_amount]': '200000',
      'line_items[0][price_data][product_data][name]':
        'Pedido YEK-2026-ABCD1234',
      client_reference_id: 'YEK-2026-ABCD1234',
      'metadata[order_number]': 'YEK-2026-ABCD1234',
      success_url: 'https://yekora.mx/checkout/exito/',
      cancel_url: 'https://yekora.mx/checkout/cancelado/',
      'adaptive_pricing[enabled]': 'false',
    });
    expect(form.has('payment_method_options[oxxo][expires_after_days]')).toBe(
      false
    );
    expect(session).toEqual({
      reference: 'cs_test_1',
      redirectUrl: 'https://checkout.stripe.com/c/pay/cs_test_1',
      remoteExpiresAt: new Date(NOW.getTime() + 30 * MIN),
    });
  });

  it('T2: the session expires 30 min before the order hold, capped at Stripe’s 24 h', async () => {
    const at = async (holdMinutes: number) => {
      const fetchMock = answering({
        id: 'cs',
        url: 'https://checkout.stripe.com/x',
      });
      const expiresAt = new Date(NOW.getTime() + holdMinutes * MIN);
      const session = await createStripeAdapter(
        SECRETS,
        fetchMock
      ).createSession(request({ expiresAt }));
      const sent = Number(sentForm(fetchMock).get('expires_at')) * 1000;
      expect(sent).toBe(session.remoteExpiresAt.getTime());
      expect(expiresAt.getTime() - sent).toBeGreaterThanOrEqual(
        REMOTE_EXPIRY_MARGIN_MS
      );
      return sent - NOW.getTime();
    };
    expect(await at(60)).toBe(30 * MIN); // the shortest Stripe accepts
    expect(await at(120)).toBe(90 * MIN);
    expect(await at(72 * 60)).toBe(24 * 60 * MIN); // Stripe's ceiling
  });

  it('refuses a hold too short for a 30-minute session instead of calling Stripe', async () => {
    const fetchMock = answering({});
    await expect(
      createStripeAdapter(SECRETS, fetchMock).createSession(
        request({ expiresAt: new Date(NOW.getTime() + 59 * MIN) })
      )
    ).rejects.toThrow('the order hold is too short for a session');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('OXXO: one-day voucher, payable until 23:59:59 Mexico City of the next day, inside the hold', async () => {
    const fetchMock = answering({
      id: 'cs_oxxo',
      url: 'https://checkout.stripe.com/x',
    });
    const session = await createStripeAdapter(SECRETS, fetchMock).createSession(
      request({
        method: 'OXXO',
        expiresAt: new Date(NOW.getTime() + 72 * 60 * MIN),
      })
    );
    const form = sentForm(fetchMock);
    expect(form.get('payment_method_types[0]')).toBe('oxxo');
    // OXXO is MXN only, and the order total is reconciled in MXN: never converted.
    expect(form.get('adaptive_pricing[enabled]')).toBe('false');
    expect(form.get('payment_method_options[oxxo][expires_after_days]')).toBe(
      '1'
    );
    // 2026-10-22 23:59:59 in Mexico City = 2026-10-23 05:59:59 UTC.
    expect(session.remoteExpiresAt).toEqual(new Date('2026-10-23T05:59:59Z'));
  });

  it('OXXO: the voucher day follows Mexico City’s date, not UTC’s', async () => {
    // 2026-10-22 03:00 UTC is still 2026-10-21 21:00 in Mexico City.
    const now = new Date('2026-10-22T03:00:00Z');
    const fetchMock = answering({
      id: 'cs',
      url: 'https://checkout.stripe.com/x',
    });
    const session = await createStripeAdapter(SECRETS, fetchMock).createSession(
      request({
        method: 'OXXO',
        now,
        expiresAt: new Date(now.getTime() + 72 * 60 * MIN),
      })
    );
    expect(session.remoteExpiresAt).toEqual(new Date('2026-10-23T05:59:59Z'));
  });

  it('OXXO: refuses a hold the voucher would outlive (a late payment would be possible)', async () => {
    const fetchMock = answering({});
    await expect(
      createStripeAdapter(SECRETS, fetchMock).createSession(
        request({
          method: 'OXXO',
          expiresAt: new Date(NOW.getTime() + 24 * 60 * MIN),
        })
      )
    ).rejects.toThrow('the voucher would outlive the order hold');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses methods that belong to Mercado Pago', async () => {
    for (const method of ['SPEI', 'MERCADO_PAGO_BALANCE'] as const) {
      await expect(
        createStripeAdapter(SECRETS, answering({})).createSession(
          request({ method })
        )
      ).rejects.toThrow(`unsupported method ${method}`);
    }
  });

  it('reports an HTTP error or an unexpected answer without leaking the key', async () => {
    const error = await createStripeAdapter(SECRETS, answering({}, 401))
      .createSession(request())
      .catch((e: Error) => e);
    expect(error).toMatchObject({
      name: 'PaymentProcessorError',
      message: 'Stripe: HTTP 401',
    });
    expect(String(error)).not.toContain('sk_test_key');
    await expect(
      createStripeAdapter(SECRETS, answering({ id: 'cs' })).createSession(
        request()
      )
    ).rejects.toThrow('unexpected session answer');
  });
});

describe('verifyWebhook (raw bytes, constant time, 300 s)', () => {
  const adapter = createStripeAdapter(SECRETS, answering({}));
  const body = Buffer.from(
    JSON.stringify({
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_1' } },
    })
  );
  const t = Math.floor(NOW.getTime() / 1000);
  const sign = (raw: Buffer, secret = SECRETS.webhookSecret, ts = t) =>
    createHmac('sha256', secret).update(`${ts}.`).update(raw).digest('hex');
  const verify = (
    raw: Buffer,
    signature: string | string[] | undefined,
    now = NOW
  ) =>
    adapter.verifyWebhook({
      rawBody: raw,
      headers: { 'stripe-signature': signature },
      query: {},
      now,
    });

  it('accepts a valid signature and returns the event and its session', () => {
    expect(verify(body, `t=${t},v1=${sign(body)}`)).toEqual({
      eventId: 'evt_1',
      type: 'checkout.session.completed',
      resourceId: 'cs_test_1',
    });
  });

  it('accepts any valid v1 among several (secret rotation) and the header as an array', () => {
    expect(
      verify(body, [`t=${t},v1=${'00'.repeat(32)},v1=${sign(body)}`])
    ).toMatchObject({
      eventId: 'evt_1',
    });
  });

  it('rejects one flipped bit of the body, another secret, or no signature', () => {
    const flipped = Buffer.from(body);
    flipped[10] ^= 0x01;
    expect(verify(flipped, `t=${t},v1=${sign(body)}`)).toBeNull();
    expect(verify(body, `t=${t},v1=${sign(body, 'whsec_other')}`)).toBeNull();
    expect(verify(body, undefined)).toBeNull();
    expect(verify(body, `t=${t}`)).toBeNull();
    expect(verify(body, `t=${t},v1=zz`)).toBeNull();
  });

  it('rejects a replay older or newer than 300 s and a malformed timestamp', () => {
    const later = new Date(NOW.getTime() + 301_000);
    expect(verify(body, `t=${t},v1=${sign(body)}`, later)).toBeNull();
    expect(
      verify(body, `t=${t},v1=${sign(body)}`, new Date(NOW.getTime() + 300_000))
    ).not.toBeNull();
    expect(verify(body, `t=1e9,v1=${sign(body, undefined, 1e9)}`)).toBeNull();
  });

  it('rejects a signed body that is not a Stripe event', () => {
    for (const raw of [Buffer.from('not json'), Buffer.from('{"type":"x"}')]) {
      expect(verify(raw, `t=${t},v1=${sign(raw)}`)).toBeNull();
    }
  });

  it('keeps an event without an object id, with no resource to reconcile', () => {
    const raw = Buffer.from(
      JSON.stringify({ id: 'evt_2', type: 'ping', data: {} })
    );
    expect(verify(raw, `t=${t},v1=${sign(raw)}`)).toEqual({
      eventId: 'evt_2',
      type: 'ping',
      resourceId: null,
    });
  });
});

describe('fetchPayment (reconciliation)', () => {
  it('reads the session back: paid, amount in cents, currency upper case, order number', async () => {
    const fetchMock = answering({
      payment_status: 'paid',
      amount_total: 200000,
      currency: 'mxn',
      client_reference_id: 'YEK-2026-ABCD1234',
    });
    await expect(
      createStripeAdapter(SECRETS, fetchMock).fetchPayment('cs_test/1')
    ).resolves.toEqual({
      paid: true,
      amountMxnCents: 200000,
      currency: 'MXN',
      orderNumber: 'YEK-2026-ABCD1234',
      processorStatus: 'paid',
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.stripe.com/v1/checkout/sessions/cs_test%2F1'
    );
    expect(fetchMock.mock.calls[0][1]?.method).toBe('GET');
  });

  it('treats anything but paid as not paid, and unknown fields as missing', async () => {
    await expect(
      createStripeAdapter(
        SECRETS,
        answering({ payment_status: 'unpaid', amount_total: 1.5 })
      ).fetchPayment('cs')
    ).resolves.toEqual({
      paid: false,
      amountMxnCents: null,
      currency: null,
      orderNumber: null,
      processorStatus: 'unpaid',
    });
    await expect(
      createStripeAdapter(SECRETS, answering({})).fetchPayment('cs')
    ).resolves.toMatchObject({ paid: false, processorStatus: 'unknown' });
  });
});

describe('verifyWebhook with a bare v1', () => {
  it('rejects a v1 entry without a value', () => {
    const adapter = createStripeAdapter(SECRETS, answering({}));
    const t = Math.floor(NOW.getTime() / 1000);
    expect(
      adapter.verifyWebhook({
        rawBody: Buffer.from('{}'),
        headers: { 'stripe-signature': `t=${t},v1` },
        query: {},
        now: NOW,
      })
    ).toBeNull();
  });
});
