/**
 * API configuration from the environment (FC 008), validated once at startup.
 *
 * Production fails closed (ADR 0006, R4): missing database settings stop the process before it
 * listens, instead of running half-configured. Secrets are read here and never logged.
 *
 * Payments (FC 012, 092_AN §2): PAYMENTS_MODE is declared, never inferred. In `sandbox` only
 * test keys are accepted and in `live` only live keys, so a mixed set stops the start instead
 * of charging with the wrong account. A processor needs both of its secrets or none, and the
 * checkout needs its three secrets (personal-data key and two peppers) or none. Without them
 * the checkout answers 503: closed, never half-open (T1.1 K).
 *
 * Mercado Pago (FC 019): its test credentials may also start with `APP_USR-`, the live prefix,
 * so the prefix alone no longer tells the accounts apart. In `sandbox` such a token needs the
 * operator's MP_SANDBOX_IS_TEST_ACCOUNT=true here, and `start` then asks Mercado Pago whether
 * the account really is a test one (in `live`, that it is not) before listening.
 *
 * @module
 */
import { z } from 'zod';
import { parsePiiKey } from './services/checkoutCrypto';
import type { MercadoPagoSecrets } from './services/mercadoPagoAdapter';
import type { StripeSecrets } from './services/stripeAdapter';

/** Origins allowed by CORS: the public site and the two local servers (dev and E2E). */
export const CORS_ORIGINS = [
  'https://yekora.mx',
  'http://localhost:3000',
  'http://localhost:3100',
];

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().nonnegative().default(3001),
  HOST: z.string().default('0.0.0.0'),
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().default(''),
  // Same rule as scripts/lib/migrations.ts::isYekoraDatabase: `yekora_…` locally, Hostinger's
  // `u<digits>_yekora[_…]` in production; never another project's database.
  DB_NAME: z
    .string()
    .regex(
      /^(?:u\d+_yekora(?:_[a-z0-9_]+)?|yekora_[a-z0-9_]+)$/,
      'must be a Yekora database'
    ),
  BANXICO_TOKEN: z.string().optional(),
  API_VERSION: z.string().default('0.8.5'),
  GIT_SHA: z.string().default('dev'),
  PAYMENTS_MODE: z.enum(['sandbox', 'live']).default('sandbox'),
  SITE_URL: z.url().default('https://yekora.mx'),
  API_PUBLIC_URL: z.url().default('https://apiv1.yekora.mx'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  MP_ACCESS_TOKEN: z.string().optional(),
  MP_WEBHOOK_SECRET: z.string().optional(),
  MP_SANDBOX_IS_TEST_ACCOUNT: z.enum(['true', 'false']).default('false'),
  CHECKOUT_PII_KEY: z.string().optional(),
  CUSTOMER_EMAIL_HMAC_PEPPER: z.string().optional(),
  ORDER_TOKEN_PEPPER: z.string().optional(),
});

/**
 * Key prefixes each mode accepts (Stripe secret or restricted keys; Mercado Pago tokens).
 * `APP_USR-` in sandbox is not proof of a test account: see `loadPayments` (FC 019).
 */
const KEY_PREFIXES = {
  sandbox: {
    stripe: ['sk_test_', 'rk_test_'],
    mercadoPago: ['TEST-', 'APP_USR-'],
  },
  live: { stripe: ['sk_live_', 'rk_live_'], mercadoPago: ['APP_USR-'] },
} as const;

/** The checkout's own secrets (FC 012), all three or none. */
export interface CheckoutSecrets {
  /** AES-256-GCM key of personal data (CHECKOUT_PII_KEY, 32 bytes). */
  piiKey: Buffer;
  /** Pepper of the e-mail lookup HMAC (CUSTOMER_EMAIL_HMAC_PEPPER). */
  emailPepper: string;
  /** Pepper of the order access token HMAC (ORDER_TOKEN_PEPPER). */
  tokenPepper: string;
}

/** Payment settings of this deployment. */
export interface PaymentsConfig {
  /** Declared mode: test keys only in `sandbox`, live keys only in `live`. */
  mode: 'sandbox' | 'live';
  /** Public site, for the processors' return URLs. */
  siteUrl: string;
  /** Public API, for the processors' webhook URLs. */
  apiUrl: string;
  /** Stripe account, or null when not configured. */
  stripe: StripeSecrets | null;
  /** Mercado Pago application, or null when not configured. */
  mercadoPago: MercadoPagoSecrets | null;
  /** Checkout secrets, or null when not configured. */
  checkout: CheckoutSecrets | null;
}

/** Database connection settings. */
export interface DbConfig {
  /** MariaDB host. */
  host: string;
  /** MariaDB port. */
  port: number;
  /** Database user. */
  user: string;
  /** Database password (empty only for local XAMPP root). */
  password: string;
  /** Database name; always Yekora's (`yekora_…` or Hostinger's `u<id>_yekora…`). */
  database: string;
}

/** Everything the API needs to start. */
export interface ApiConfig {
  /** Whether this is the production deployment. */
  isProduction: boolean;
  /** Port to listen on (Hostinger sets PORT). */
  port: number;
  /** Interface to bind. */
  host: string;
  /** Database settings. */
  db: DbConfig;
  /** Banxico SIE token; without it the API serves the last stored FIX only. */
  banxicoToken: string | undefined;
  /** Released version, reported by /health. */
  version: string;
  /** Deployed commit, reported by /health and checked by the deploy smoke test. */
  sha: string;
  /** Payment processors and checkout secrets (FC 012). */
  payments: PaymentsConfig;
}

/** A pair of secrets that must be configured together, or null when both are absent. */
function pair(name: string, a?: string, b?: string): [string, string] | null {
  if (!a && !b) return null;
  if (!a || !b) throw new Error(`${name} needs both of its secrets or none`);
  return [a, b];
}

/** Refuses a key whose prefix does not belong to the declared mode (092_AN §2). */
function checkMode(
  name: string,
  key: string,
  prefixes: readonly string[]
): void {
  if (!prefixes.some((prefix) => key.startsWith(prefix))) {
    throw new Error(`${name} does not match PAYMENTS_MODE`);
  }
}

function loadPayments(parsed: z.infer<typeof schema>): PaymentsConfig {
  const mode = parsed.PAYMENTS_MODE;
  const prefixes = KEY_PREFIXES[mode];
  const stripe = pair(
    'Stripe',
    parsed.STRIPE_SECRET_KEY,
    parsed.STRIPE_WEBHOOK_SECRET
  );
  if (stripe) checkMode('STRIPE_SECRET_KEY', stripe[0], prefixes.stripe);
  const mercadoPago = pair(
    'Mercado Pago',
    parsed.MP_ACCESS_TOKEN,
    parsed.MP_WEBHOOK_SECRET
  );
  if (mercadoPago) {
    checkMode('MP_ACCESS_TOKEN', mercadoPago[0], prefixes.mercadoPago);
    // A live-looking token in sandbox needs the operator's word first (FC 019 T1.1 C); the
    // account itself is checked against Mercado Pago when the API starts (T1.1 V).
    if (
      mode === 'sandbox' &&
      mercadoPago[0].startsWith('APP_USR-') &&
      parsed.MP_SANDBOX_IS_TEST_ACCOUNT !== 'true'
    ) {
      throw new Error(
        'MISSING_APP_USR_CONFIRMATION: MP_ACCESS_TOKEN with APP_USR- in sandbox requires explicit MP_SANDBOX_IS_TEST_ACCOUNT=true'
      );
    }
  }
  const key = parsed.CHECKOUT_PII_KEY;
  const peppers = pair(
    'The checkout',
    parsed.CUSTOMER_EMAIL_HMAC_PEPPER,
    parsed.ORDER_TOKEN_PEPPER
  );
  if (Boolean(key) !== Boolean(peppers)) {
    throw new Error('The checkout needs its three secrets or none');
  }
  if (peppers?.some((pepper) => pepper.length < 32)) {
    throw new Error('Checkout peppers must be at least 32 characters');
  }
  return {
    mode,
    siteUrl: parsed.SITE_URL.replace(/\/$/, ''),
    apiUrl: parsed.API_PUBLIC_URL.replace(/\/$/, ''),
    stripe: stripe && { apiKey: stripe[0], webhookSecret: stripe[1] },
    mercadoPago: mercadoPago && {
      accessToken: mercadoPago[0],
      webhookSecret: mercadoPago[1],
    },
    checkout:
      key && peppers
        ? {
            piiKey: parsePiiKey(key),
            emailPepper: peppers[0],
            tokenPepper: peppers[1],
          }
        : null,
  };
}

/**
 * Parses and validates the environment.
 *
 * @param env - Usually `process.env`.
 * @returns The validated configuration.
 * @throws When a required setting is missing, or production has an empty DB password.
 */
export function loadConfig(env: Record<string, string | undefined>): ApiConfig {
  const parsed = schema.parse(env);
  const isProduction = parsed.NODE_ENV === 'production';
  if (isProduction && parsed.DB_PASSWORD === '') {
    throw new Error('DB_PASSWORD is required in production');
  }
  return {
    isProduction,
    port: parsed.PORT,
    host: parsed.HOST,
    db: {
      host: parsed.DB_HOST,
      port: parsed.DB_PORT,
      user: parsed.DB_USER,
      password: parsed.DB_PASSWORD,
      database: parsed.DB_NAME,
    },
    banxicoToken: parsed.BANXICO_TOKEN || undefined,
    version: parsed.API_VERSION,
    sha: parsed.GIT_SHA,
    payments: loadPayments(parsed),
  };
}
