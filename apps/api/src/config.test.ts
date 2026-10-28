import { describe, expect, it } from 'vitest';
import { CORS_ORIGINS, loadConfig } from './config';

const base = { DB_HOST: '127.0.0.1', DB_USER: 'root', DB_NAME: 'yekora_dev' };

describe('loadConfig', () => {
  it('fills safe defaults for local development', () => {
    expect(loadConfig(base)).toEqual({
      isProduction: false,
      port: 3001,
      host: '0.0.0.0',
      db: {
        host: '127.0.0.1',
        port: 3306,
        user: 'root',
        password: '',
        database: 'yekora_dev',
      },
      banxicoToken: undefined,
      version: '0.8.2',
      sha: 'dev',
      // FC 012: sandbox by default and nothing configured, so the checkout stays closed (503).
      payments: {
        mode: 'sandbox',
        siteUrl: 'https://yekora.mx',
        apiUrl: 'https://apiv1.yekora.mx',
        stripe: null,
        mercadoPago: null,
        checkout: null,
      },
    });
  });

  it('reads the production settings, including the deployed SHA and the Banxico token', () => {
    const config = loadConfig({
      ...base,
      NODE_ENV: 'production',
      PORT: '8080',
      DB_PASSWORD: 's3cret',
      BANXICO_TOKEN: 'token',
      GIT_SHA: 'abc123',
    });
    expect(config).toMatchObject({
      isProduction: true,
      port: 8080,
      banxicoToken: 'token',
      sha: 'abc123',
    });
    expect(config.db.password).toBe('s3cret');
  });

  it('fails closed in production without a database password', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(
      'DB_PASSWORD is required in production'
    );
  });

  it('accepts the Hostinger database of the account (u<id>_yekora)', () => {
    expect(
      loadConfig({ ...base, DB_NAME: 'u123456789_yekora' }).db.database
    ).toBe('u123456789_yekora');
  });

  it.each([
    ['a non-Yekora database', { ...base, DB_NAME: 'archon' }],
    [
      'another project on the same Hostinger account',
      { ...base, DB_NAME: 'u123456789_archon' },
    ],
    ['a missing host', { DB_USER: 'root', DB_NAME: 'yekora_dev' }],
  ])('refuses %s', (_case, env) => {
    expect(() => loadConfig(env)).toThrow();
  });

  it('treats an empty Banxico token as no token', () => {
    expect(
      loadConfig({ ...base, BANXICO_TOKEN: '' }).banxicoToken
    ).toBeUndefined();
  });

  it('allows only the public site and the local servers as CORS origins', () => {
    expect(CORS_ORIGINS).toEqual([
      'https://yekora.mx',
      'http://localhost:3000',
      'http://localhost:3100',
    ]);
  });
});

describe('loadConfig · payments (FC 012, 092_AN §2)', () => {
  const pii = Buffer.alloc(32, 7).toString('base64');
  const pepper = 'p'.repeat(32);
  const checkout = {
    CHECKOUT_PII_KEY: pii,
    CUSTOMER_EMAIL_HMAC_PEPPER: pepper,
    ORDER_TOKEN_PEPPER: `${pepper}x`,
  };
  const sandboxKeys = {
    STRIPE_SECRET_KEY: 'sk_test_1',
    STRIPE_WEBHOOK_SECRET: 'whsec_1',
    MP_ACCESS_TOKEN: 'TEST-1',
    MP_WEBHOOK_SECRET: 'mp_1',
  };

  it('reads a full sandbox: both processors and the checkout secrets', () => {
    const { payments } = loadConfig({
      ...base,
      ...sandboxKeys,
      ...checkout,
      SITE_URL: 'https://yekora.mx/',
      API_PUBLIC_URL: 'https://apiv1.yekora.mx/',
    });
    expect(payments).toEqual({
      mode: 'sandbox',
      siteUrl: 'https://yekora.mx',
      apiUrl: 'https://apiv1.yekora.mx',
      stripe: { apiKey: 'sk_test_1', webhookSecret: 'whsec_1' },
      mercadoPago: { accessToken: 'TEST-1', webhookSecret: 'mp_1' },
      checkout: {
        piiKey: Buffer.alloc(32, 7),
        emailPepper: pepper,
        tokenPepper: `${pepper}x`,
      },
    });
  });

  it('accepts live keys only in live mode, and restricted Stripe keys too', () => {
    const { payments } = loadConfig({
      ...base,
      PAYMENTS_MODE: 'live',
      STRIPE_SECRET_KEY: 'rk_live_1',
      STRIPE_WEBHOOK_SECRET: 'whsec_1',
      MP_ACCESS_TOKEN: 'APP_USR-1',
      MP_WEBHOOK_SECRET: 'mp_1',
    });
    expect(payments.mode).toBe('live');
    expect(payments.stripe?.apiKey).toBe('rk_live_1');
    expect(payments.mercadoPago?.accessToken).toBe('APP_USR-1');
  });

  it.each([
    [
      'a live Stripe key in sandbox',
      { STRIPE_SECRET_KEY: 'sk_live_1', STRIPE_WEBHOOK_SECRET: 'w' },
      'STRIPE_SECRET_KEY does not match PAYMENTS_MODE',
    ],
    [
      'a test Mercado Pago token in live',
      {
        PAYMENTS_MODE: 'live',
        MP_ACCESS_TOKEN: 'TEST-1',
        MP_WEBHOOK_SECRET: 'w',
      },
      'MP_ACCESS_TOKEN does not match PAYMENTS_MODE',
    ],
    [
      'half of Stripe',
      { STRIPE_SECRET_KEY: 'sk_test_1' },
      'Stripe needs both of its secrets or none',
    ],
    [
      'half of Mercado Pago',
      { MP_WEBHOOK_SECRET: 'w' },
      'Mercado Pago needs both of its secrets or none',
    ],
    [
      'the key without peppers',
      { CHECKOUT_PII_KEY: pii },
      'The checkout needs its three secrets or none',
    ],
    [
      'peppers without the key',
      { CUSTOMER_EMAIL_HMAC_PEPPER: pepper, ORDER_TOKEN_PEPPER: pepper },
      'The checkout needs its three secrets or none',
    ],
    [
      'one pepper only',
      { CHECKOUT_PII_KEY: pii, ORDER_TOKEN_PEPPER: pepper },
      'The checkout needs both of its secrets or none',
    ],
    [
      'a short pepper',
      { ...checkout, ORDER_TOKEN_PEPPER: 'short' },
      'Checkout peppers must be at least 32 characters',
    ],
    [
      'a malformed personal-data key',
      { ...checkout, CHECKOUT_PII_KEY: 'abc' },
      'CHECKOUT_PII_KEY must be 32 random bytes',
    ],
    ['an unknown mode', { PAYMENTS_MODE: 'demo' }, 'Invalid option'],
  ])('refuses to start with %s', (_case, env, message) => {
    expect(() => loadConfig({ ...base, ...env })).toThrow(message);
  });
});
