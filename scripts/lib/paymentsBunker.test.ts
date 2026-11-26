/**
 * FC 070 F1 evidence of the go-live checks: the checkout secrets, the Stripe webhook endpoint and
 * the scan for credentials in the tree. No finding ever prints a value.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  checkRotation,
  checkCheckoutSecrets,
  checkStripeWebhook,
  formatReport,
  scanForSecrets,
} from './paymentsBunker';

const REQUIRED_STRIPE_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'charge.refunded',
];
const KEY = Buffer.alloc(32, 7).toString('base64');
const PEPPER = 'p'.repeat(32);
const GOOD = {
  CHECKOUT_PII_KEY: KEY,
  CUSTOMER_EMAIL_HMAC_PEPPER: PEPPER,
  ORDER_TOKEN_PEPPER: PEPPER,
};

describe('checkCheckoutSecrets', () => {
  it('passes with a 32-byte key and two peppers of 32 characters', () => {
    const findings = checkCheckoutSecrets(GOOD);
    expect(findings.map(({ ok }) => ok)).toEqual([true, true, true]);
    expect(findings[0].detail).toBe('32 bytes in base64');
    expect(findings[1].detail).toBe('32 characters');
  });

  it.each([
    ['missing', undefined],
    ['of 16 bytes', Buffer.alloc(16, 7).toString('base64')],
    ['not canonical base64', `${KEY}=`],
  ])('fails a key %s', (_name, key) => {
    const [finding] = checkCheckoutSecrets({ ...GOOD, CHECKOUT_PII_KEY: key });
    expect(finding.ok).toBe(false);
    expect(finding.detail).toContain('32 random bytes');
  });

  it('fails a short or absent pepper, naming it and its length only', () => {
    const findings = checkCheckoutSecrets({
      ...GOOD,
      CUSTOMER_EMAIL_HMAC_PEPPER: 'short',
      ORDER_TOKEN_PEPPER: undefined,
    });
    expect(findings.slice(1)).toEqual([
      {
        check: 'CUSTOMER_EMAIL_HMAC_PEPPER',
        ok: false,
        detail: 'needs at least 32 characters, has 5',
      },
      {
        check: 'ORDER_TOKEN_PEPPER',
        ok: false,
        detail: 'needs at least 32 characters, has 0',
      },
    ]);
  });
});

describe('checkStripeWebhook', () => {
  const URL = 'https://apiv1.yekora.mx';
  const endpoint = (over: Record<string, unknown> = {}) => ({
    url: `${URL}/v1/webhooks/stripe`,
    status: 'enabled',
    enabled_events: [...REQUIRED_STRIPE_EVENTS],
    ...over,
  });
  const listing = (data: unknown, status = 200) =>
    vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ data }), { status })
    );

  it('passes for an enabled endpoint at the canonical address that listens to every event', async () => {
    const fetchMock = listing([endpoint()]);
    const finding = await checkStripeWebhook('rk_live_x', `${URL}/`, fetchMock);
    expect(finding).toMatchObject({
      check: 'STRIPE_WEBHOOK_ENDPOINT',
      ok: true,
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.stripe.com/v1/webhook_endpoints?limit=100'
    );
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({
      Authorization: 'Bearer rk_live_x',
    });
  });

  it('accepts an endpoint that listens to every event with *', async () => {
    const finding = await checkStripeWebhook(
      'k',
      URL,
      listing([endpoint({ enabled_events: ['*'] })])
    );
    expect(finding.ok).toBe(true);
  });

  it.each([
    ['another address', [endpoint({ url: 'https://other.example/hook' })]],
    ['a disabled endpoint', [endpoint({ status: 'disabled' })]],
    ['no endpoint at all', []],
  ])('fails with %s', async (_name, data) => {
    const finding = await checkStripeWebhook('k', URL, listing(data));
    expect(finding.ok).toBe(false);
    expect(finding.detail).toBe(
      `no enabled endpoint at ${URL}/v1/webhooks/stripe`
    );
  });

  it('fails when Stripe sends no list at all', async () => {
    const answer = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({}))
    );
    expect((await checkStripeWebhook('k', URL, answer)).ok).toBe(false);
  });

  it('names the events the endpoint does not listen to', async () => {
    const finding = await checkStripeWebhook(
      'k',
      URL,
      listing([endpoint({ enabled_events: ['checkout.session.completed'] })])
    );
    expect(finding.ok).toBe(false);
    expect(finding.detail).toBe(
      'does not listen to checkout.session.async_payment_succeeded, charge.refunded'
    );
  });

  it('treats a missing event list as listening to nothing', async () => {
    const finding = await checkStripeWebhook(
      'k',
      URL,
      listing([endpoint({ enabled_events: undefined })])
    );
    expect(finding.detail).toContain('does not listen to');
  });

  it('says what the key needs when Stripe refuses the read, without echoing anything', async () => {
    const finding = await checkStripeWebhook(
      'rk_live_secretvalue',
      URL,
      listing([], 403)
    );
    expect(finding).toEqual({
      check: 'STRIPE_WEBHOOK_ENDPOINT',
      ok: false,
      detail:
        'Stripe refused the read (HTTP 403); the key needs Webhooks: read',
    });
  });

  it('fails when Stripe cannot be reached', async () => {
    const down = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await checkStripeWebhook('k', URL, down)).toMatchObject({
      ok: false,
      detail: 'Stripe could not be reached',
    });
  });
});

describe('scanForSecrets', () => {
  const live = `sk_live_${'A'.repeat(24)}`;

  it('passes a tree whose keys are short fixtures or none', () => {
    const finding = scanForSecrets([
      { path: 'a.ts', text: "const k = 'sk_live_1'; const w = 'whsec_test';" },
      { path: 'b.md', text: 'APP_USR-1 and TEST-1' },
    ]);
    expect(finding).toEqual({
      check: 'NO_CREDENTIALS_IN_TREE',
      ok: true,
      detail: '2 files, none holds a credential',
    });
  });

  it.each([
    ['a Stripe live key', live],
    ['a Stripe live key', `rk_live_${'B'.repeat(24)}`],
    ['a Stripe test key', `sk_test_${'C'.repeat(24)}`],
    ['a Stripe webhook secret', `whsec_${'D'.repeat(24)}`],
    ['a Mercado Pago token', `APP_USR-12345678-123456-${'a'.repeat(32)}`],
  ])('finds %s and reports its path, never its value', (kind, value) => {
    const finding = scanForSecrets([
      { path: 'clean.ts', text: 'nothing here' },
      { path: 'env/prod.txt', text: `KEY=${value}` },
    ]);
    expect(finding.ok).toBe(false);
    expect(finding.detail).toBe(`env/prod.txt: ${kind}`);
    expect(finding.detail).not.toContain(value);
  });
});

describe('formatReport', () => {
  it('prints one line per finding and passes only when every one does', () => {
    const report = formatReport([
      { check: 'A', ok: true, detail: 'fine' },
      { check: 'B', ok: false, detail: 'broken' },
    ]);
    expect(report.text).toBe('[OK] A: fine\n[FAIL] B: broken');
    expect(report.ok).toBe(false);
    expect(formatReport([{ check: 'A', ok: true, detail: 'x' }]).ok).toBe(true);
  });
});

describe('checkRotation (FC 075 F4)', () => {
  const sandbox = {
    PAYMENTS_MODE: 'sandbox',
    STRIPE_SECRET_KEY: 'sk_test_1',
    STRIPE_WEBHOOK_SECRET: 'whsec_a',
  };
  const failing = (env: Record<string, string | undefined>) =>
    checkRotation(env)
      .filter((f) => !f.ok)
      .map((f) => f.check);

  it('passes one secret, and two distinct ones while a rotation is in progress', () => {
    expect(failing(sandbox)).toEqual([]);
    const rotating = checkRotation({
      ...sandbox,
      STRIPE_WEBHOOK_SECRET: 'whsec_a, whsec_b',
    });
    expect(rotating.every((f) => f.ok)).toBe(true);
    expect(rotating[2].detail).toContain('rotation is in progress');
  });

  it.each([
    ['none', ''],
    ['three', 'whsec_a,whsec_b,whsec_c'],
    ['a repeated one', 'whsec_a,whsec_a'],
    ['one without the prefix', 'whsec_a,secret'],
  ])('refuses %s', (_case, value) => {
    expect(failing({ ...sandbox, STRIPE_WEBHOOK_SECRET: value })).toEqual([
      'STRIPE_WEBHOOK_SECRET_LIST',
    ]);
  });

  it('wants a restricted key of the declared mode in live', () => {
    const live = { ...sandbox, PAYMENTS_MODE: 'live' };
    expect(failing({ ...live, STRIPE_SECRET_KEY: 'rk_live_1' })).toEqual([]);
    expect(failing({ ...live, STRIPE_SECRET_KEY: 'sk_live_1' })).toEqual([
      'STRIPE_KEY_SCOPE',
    ]);
    expect(failing(live)).toEqual(['STRIPE_KEY_MODE', 'STRIPE_KEY_SCOPE']);
    expect(
      failing({ PAYMENTS_MODE: 'sandbox', STRIPE_WEBHOOK_SECRET: 'whsec_a' })
    ).toEqual(['STRIPE_KEY_MODE']);
  });

  it('checks the Mercado Pago list only when Mercado Pago is used', () => {
    expect(checkRotation(sandbox).map((f) => f.check)).not.toContain(
      'MP_WEBHOOK_SECRET_LIST'
    );
    const mp = { ...sandbox, MP_ACCESS_TOKEN: 'TEST-1' };
    expect(failing({ ...mp, MP_WEBHOOK_SECRET: 'm1,m2' })).toEqual([]);
    expect(failing(mp)).toEqual(['MP_WEBHOOK_SECRET_LIST']);
  });

  it('never repeats a secret in what it prints', () => {
    const text = JSON.stringify(
      checkRotation({ ...sandbox, STRIPE_WEBHOOK_SECRET: 'whsec_topsecret,x' })
    );
    expect(text).not.toContain('topsecret');
    expect(text).not.toContain('sk_test_1');
  });
});
