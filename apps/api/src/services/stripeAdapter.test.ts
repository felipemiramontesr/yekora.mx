import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { type SessionRequest } from './paymentPort';
import { createStripeAdapter, createStripeCards } from './stripeAdapter';

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
      'Stripe-Version': '2026-03-25.dahlia',
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

  it('names what Stripe objected to (type, code, parameter) and never its free text, which may echo a key', async () => {
    const refused = {
      error: {
        type: 'invalid_request_error',
        code: 'parameter_invalid_empty',
        param: 'success_url',
        message: 'Invalid API Key provided: sk_test_key',
      },
    };
    const error = await createStripeCards(SECRETS, answering(refused, 400))
      .createSetupSession({
        customerId: 'cus_1',
        successUrl: 'https://yekora.mx/cuenta/metodos-pago/',
        cancelUrl: 'https://yekora.mx/cuenta/metodos-pago/',
      })
      .catch((e: Error) => e);
    expect(error).toMatchObject({
      name: 'PaymentProcessorError',
      status: 400,
      message:
        'Stripe: HTTP 400 (invalid_request_error parameter_invalid_empty success_url)',
    });
    expect(String(error)).not.toContain('sk_test_key');
    // Only the parts that exist are named; an answer that is not Stripe's shape adds nothing.
    await expect(
      createStripeCards(
        SECRETS,
        answering({ error: { type: 'api_error' } }, 500)
      ).createCustomer('u')
    ).rejects.toThrow('Stripe: HTTP 500 (api_error)');
    for (const body of [{ error: 'boom' }, { error: null }, []]) {
      await expect(
        createStripeCards(SECRETS, answering(body, 502)).createCustomer('u')
      ).rejects.toMatchObject({ message: 'Stripe: HTTP 502' });
    }
    // A gateway page, not JSON at all: still only the status.
    const gateway = vi.fn<typeof fetch>(
      async () => new Response('<html>Bad gateway</html>', { status: 502 })
    );
    await expect(
      createStripeCards(SECRETS, gateway).createCustomer('u')
    ).rejects.toMatchObject({ message: 'Stripe: HTTP 502' });
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
    // The pinned version reads the session back with the same shapes it was created with.
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      'Stripe-Version': '2026-03-25.dahlia',
    });
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

describe('createSession binds the customer and keeps the card (FC 060 T1.1, T2.2)', () => {
  const create = async (over: Partial<SessionRequest>) => {
    const fetchMock = answering({
      id: 'cs_test_1',
      url: 'https://checkout.stripe.com/c/pay/cs_test_1',
    });
    await createStripeAdapter(SECRETS, fetchMock).createSession(request(over));
    return sentForm(fetchMock);
  };

  it('ties the session to the customer for a card payment, so Stripe offers the card they keep, and keeps nothing new', async () => {
    const form = await create({ customerId: 'cus_ana' });
    expect(form.get('customer')).toBe('cus_ana');
    expect(form.has('saved_payment_method_options[payment_method_save]')).toBe(
      false
    );
    expect(form.has('payment_intent_data[setup_future_usage]')).toBe(false);
  });

  it('asks Stripe to keep the card with its own option, and never with setup_future_usage (allow_redisplay always)', async () => {
    const form = await create({ customerId: 'cus_ana', saveCard: true });
    expect(form.get('customer')).toBe('cus_ana');
    expect(form.get('saved_payment_method_options[payment_method_save]')).toBe(
      'enabled'
    );
    expect(form.has('payment_intent_data[setup_future_usage]')).toBe(false);
    const unticked = await create({ customerId: 'cus_ana', saveCard: false });
    expect(
      unticked.has('saved_payment_method_options[payment_method_save]')
    ).toBe(false);
  });

  it('sends neither without the customer, nor for OXXO', async () => {
    for (const over of [
      {},
      {
        method: 'OXXO' as const,
        // An OXXO voucher is held 72 hours.
        expiresAt: new Date(NOW.getTime() + 72 * 60 * MIN),
        customerId: 'cus_ana',
        saveCard: true,
      },
    ]) {
      const form = await create(over);
      expect(form.has('customer')).toBe(false);
      expect(form.has('payment_intent_data[setup_future_usage]')).toBe(false);
      expect(
        form.has('saved_payment_method_options[payment_method_save]')
      ).toBe(false);
    }
  });
});

describe('createStripeCards (FC 054: the cards live at Stripe)', () => {
  const urlOf = (mock: ReturnType<typeof answering>, call = 0) =>
    String(mock.mock.calls[call][0]);
  const initOf = (mock: ReturnType<typeof answering>, call = 0) =>
    mock.mock.calls[call][1] as RequestInit;

  it('creates the customer of an account with its id as the only reference, and a key that makes a retry give the same one', async () => {
    const mock = answering({ id: 'cus_123' });
    const id = await createStripeCards(SECRETS, mock).createCustomer('user-1');
    expect(id).toBe('cus_123');
    expect(urlOf(mock)).toBe('https://api.stripe.com/v1/customers');
    expect(String(initOf(mock).body)).toBe('metadata%5Buser_id%5D=user-1');
    expect(
      (initOf(mock).headers as Record<string, string>)['Idempotency-Key']
    ).toBe('yekora-customer-user-1');
    await expect(
      createStripeCards(SECRETS, answering({})).createCustomer('user-1')
    ).rejects.toThrow('unexpected customer answer');
  });

  it('lists only brand, last four and expiry of the cards, skipping anything incomplete', async () => {
    const mock = answering({
      data: [
        {
          id: 'pm_1',
          created: 1_700_000_000,
          card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 },
          billing_details: { name: 'Ana Pérez', email: 'ana@example.test' },
        },
        {
          id: 'pm_3',
          card: { brand: 'visa', last4: '4444', exp_month: 1, exp_year: 2031 },
        },
        { id: 'pm_2', card: { brand: 'visa', last4: '1111' } },
        {
          card: { brand: 'visa', last4: '1111', exp_month: 1, exp_year: 2031 },
        },
      ],
    });
    const found = await createStripeCards(SECRETS, mock).listCards('cus_123');
    // Stripe says when each card was attached (the newest one is the card an account keeps, FC 057);
    // one that says nothing counts as the oldest.
    expect(found).toEqual([
      {
        id: 'pm_1',
        brand: 'visa',
        last4: '4242',
        expMonth: 12,
        expYear: 2030,
        created: 1_700_000_000,
      },
      {
        id: 'pm_3',
        brand: 'visa',
        last4: '4444',
        expMonth: 1,
        expYear: 2031,
        created: 0,
      },
    ]);
    expect(urlOf(mock)).toBe(
      'https://api.stripe.com/v1/customers/cus_123/payment_methods?type=card&limit=100'
    );
    expect(JSON.stringify(found)).not.toContain('ana@example.test');
    expect(
      await createStripeCards(SECRETS, answering({})).listCards('cus_123')
    ).toEqual([]);
  });

  it('says whose card it is, and nobody’s when it does not exist (404) or belongs to no customer', async () => {
    expect(
      await createStripeCards(
        SECRETS,
        answering({ customer: 'cus_9' })
      ).cardOwner('pm_1')
    ).toBe('cus_9');
    expect(
      await createStripeCards(SECRETS, answering({ customer: null })).cardOwner(
        'pm_1'
      )
    ).toBeNull();
    expect(
      await createStripeCards(SECRETS, answering({}, 404)).cardOwner('pm_1')
    ).toBeNull();
    await expect(
      createStripeCards(SECRETS, answering({}, 500)).cardOwner('pm_1')
    ).rejects.toThrow('Stripe: HTTP 500');
    await expect(
      createStripeCards(SECRETS, () =>
        Promise.reject(new TypeError('net'))
      ).cardOwner('pm_1')
    ).rejects.toThrow('net');
  });

  it('detaches a card with a POST to its own address', async () => {
    const mock = answering({ id: 'pm_1' });
    await createStripeCards(SECRETS, mock).detachCard('pm_1');
    expect(urlOf(mock)).toBe(
      'https://api.stripe.com/v1/payment_methods/pm_1/detach'
    );
    expect(initOf(mock).method).toBe('POST');
  });

  it('opens a setup session in MXN for cards only, and answers only its hosted address', async () => {
    const mock = answering({
      url: 'https://checkout.stripe.com/c/pay/cs_setup',
    });
    const url = await createStripeCards(SECRETS, mock).createSetupSession({
      customerId: 'cus_123',
      successUrl: 'https://yekora.mx/cuenta/metodos-pago/',
      cancelUrl: 'https://yekora.mx/cuenta/metodos-pago/',
    });
    expect(url).toBe('https://checkout.stripe.com/c/pay/cs_setup');
    const form = new URLSearchParams(String(initOf(mock).body));
    expect(Object.fromEntries(form)).toEqual({
      mode: 'setup',
      currency: 'mxn',
      customer: 'cus_123',
      'payment_method_types[0]': 'card',
      success_url: 'https://yekora.mx/cuenta/metodos-pago/',
      cancel_url: 'https://yekora.mx/cuenta/metodos-pago/',
    });
    await expect(
      createStripeCards(SECRETS, answering({})).createSetupSession({
        customerId: 'cus_123',
        successUrl: 'https://yekora.mx/a/',
        cancelUrl: 'https://yekora.mx/a/',
      })
    ).rejects.toThrow('unexpected setup answer');
  });

  it('never sends a card number or a security code: it has no way to', () => {
    const source = Object.keys(
      createStripeCards(SECRETS, answering({}))
    ).join();
    expect(source).not.toMatch(/number|cvc|cvv|pan/i);
  });
});

describe('fetchRefund (FC 069)', () => {
  /** A fetch that answers the charge first and then the sessions list. */
  const twoCalls = (charge: unknown, sessions: unknown) =>
    vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(charge)))
      .mockResolvedValueOnce(new Response(JSON.stringify(sessions)));

  const CHARGE = {
    payment_intent: 'pi_1',
    amount: 200000,
    amount_refunded: 200000,
    currency: 'mxn',
    refunds: { data: [{ id: 're_1' }, { id: 're_2' }, {}] },
  };

  it('reads the charge, then finds the session of its payment intent', async () => {
    const fetchMock = twoCalls(CHARGE, {
      data: [{ id: 'cs_test_1', client_reference_id: 'YEK-2026-ABCD1234' }],
    });
    await expect(
      createStripeAdapter(SECRETS, fetchMock).fetchRefund?.('ch/1')
    ).resolves.toEqual({
      sessionId: 'cs_test_1',
      orderNumber: 'YEK-2026-ABCD1234',
      amountMxnCents: 200000,
      refundedMxnCents: 200000,
      currency: 'MXN',
      refundIds: ['re_1', 're_2'],
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.stripe.com/v1/charges/ch%2F1?expand[]=refunds'
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.stripe.com/v1/checkout/sessions?payment_intent=pi_1&limit=1'
    );
    expect(fetchMock.mock.calls[1][1]?.method).toBe('GET');
  });

  it('reports a missing reference and currency as null', async () => {
    const fetchMock = twoCalls(
      { ...CHARGE, currency: undefined },
      { data: [{ id: 'cs_test_1' }] }
    );
    await expect(
      createStripeAdapter(SECRETS, fetchMock).fetchRefund?.('ch_1')
    ).resolves.toMatchObject({
      orderNumber: null,
      currency: null,
      refundIds: ['re_1', 're_2'],
    });
  });

  it('a charge without a list of refunds has none to link', async () => {
    const fetchMock = twoCalls(
      { ...CHARGE, refunds: undefined },
      { data: [{ id: 'cs_test_1' }] }
    );
    await expect(
      createStripeAdapter(SECRETS, fetchMock).fetchRefund?.('ch_1')
    ).resolves.toMatchObject({ refundIds: [] });
  });

  it.each([
    ['a charge without a payment intent', { ...CHARGE, payment_intent: null }],
    ['a charge without an amount', { ...CHARGE, amount: 'x' }],
    ['a charge without a refunded amount', { ...CHARGE, amount_refunded: 1.5 }],
  ])(
    '%s has no session to find: null and one call only',
    async (_n, charge) => {
      const fetchMock = twoCalls(charge, { data: [] });
      await expect(
        createStripeAdapter(SECRETS, fetchMock).fetchRefund?.('ch_1')
      ).resolves.toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  );

  it.each([[{ data: [] }], [{}], [{ data: [{}] }]])(
    'a payment intent with no session of ours (%j) is null',
    async (sessions) => {
      await expect(
        createStripeAdapter(SECRETS, twoCalls(CHARGE, sessions)).fetchRefund?.(
          'ch_1'
        )
      ).resolves.toBeNull();
    }
  );
});

describe('ping (FC 070 T2.2)', () => {
  it('reads one Checkout Session with the key and reports true', async () => {
    const fetchMock = answering({ data: [] });
    await expect(createStripeAdapter(SECRETS, fetchMock).ping()).resolves.toBe(
      true
    );
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.stripe.com/v1/checkout/sessions?limit=1'
    );
    expect(fetchMock.mock.calls[0][1]?.method).toBe('GET');
  });

  it.each([[401], [500]])(
    'is false on HTTP %i, and never throws',
    async (status) => {
      await expect(
        createStripeAdapter(SECRETS, answering({}, status)).ping()
      ).resolves.toBe(false);
    }
  );

  it('is false when Stripe cannot be reached', async () => {
    const down = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(createStripeAdapter(SECRETS, down).ping()).resolves.toBe(
      false
    );
  });
});

describe('fetchRefundedTotal (FC 071 T2.2)', () => {
  it('reads the payment intent of the session and the refunded amount of its latest charge', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ payment_intent: 'pi_7' }))
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ latest_charge: { amount_refunded: 125000 } })
        )
      );
    await expect(
      createStripeAdapter(SECRETS, fetchMock).fetchRefundedTotal?.('cs/1')
    ).resolves.toBe(125000);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.stripe.com/v1/checkout/sessions/cs%2F1'
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.stripe.com/v1/payment_intents/pi_7?expand[]=latest_charge'
    );
  });

  it.each([
    ['a session without payment', { payment_intent: null }, {}],
    [
      'a payment without a charge',
      { payment_intent: 'pi_7' },
      { latest_charge: null },
    ],
    [
      'a charge without a refunded amount',
      { payment_intent: 'pi_7' },
      { latest_charge: { amount_refunded: 'x' } },
    ],
  ])('refuses %s', async (_name, session, intent) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(session)))
      .mockResolvedValueOnce(new Response(JSON.stringify(intent)));
    await expect(
      createStripeAdapter(SECRETS, fetchMock).fetchRefundedTotal?.('cs_1')
    ).rejects.toThrow(
      /Stripe: the (session has no payment|payment has no charge)/
    );
  });
});

describe('createRefund (FC 071 T2.4)', () => {
  it('finds the payment intent of the session and refunds the amount with the idempotency key', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ payment_intent: 'pi_9' }))
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 're_9' })));
    await expect(
      createStripeAdapter(SECRETS, fetchMock).createRefund?.({
        paymentResourceId: 'cs/1',
        amountMxnCents: 45000,
        idempotencyKey: 'yekora-return-12',
      })
    ).resolves.toEqual({ refundId: 're_9' });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.stripe.com/v1/checkout/sessions/cs%2F1'
    );
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://api.stripe.com/v1/refunds');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      'Idempotency-Key': 'yekora-return-12',
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    expect(String(init?.body)).toBe(
      'payment_intent=pi_9&amount=45000&reason=requested_by_customer'
    );
  });

  it('refuses a session that took no payment, and an answer without an id', async () => {
    const noPayment = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ payment_intent: null }))
      );
    await expect(
      createStripeAdapter(SECRETS, noPayment).createRefund?.({
        paymentResourceId: 'cs_1',
        amountMxnCents: 1,
        idempotencyKey: 'k',
      })
    ).rejects.toThrow('Stripe: the session has no payment');
    const noId = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ payment_intent: 'pi_1' }))
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({})));
    await expect(
      createStripeAdapter(SECRETS, noId).createRefund?.({
        paymentResourceId: 'cs_1',
        amountMxnCents: 1,
        idempotencyKey: 'k',
      })
    ).rejects.toThrow('Stripe: unexpected refund answer');
  });
});
