/**
 * The mechanical checks that come before real payments are switched on (FC 070 F1, K-75 + K-26).
 * Each check answers with a finding that names what was checked and why it failed, never with a
 * value of a secret: a key, a token or a webhook secret is not printed, not even partly.
 *
 * - {@link checkCheckoutSecrets}: the three secrets of the checkout have the shape the API needs.
 * - {@link checkStripeWebhook}: Stripe delivers the events the store listens to, to the canonical
 *   address, from an enabled endpoint. Stripe never returns the signing secret of an endpoint, so
 *   it cannot be compared here; the first signed delivery in sandbox is that proof.
 * - {@link scanForSecrets}: no tracked file holds a credential in clear text.
 *
 * @module
 */

/** One result of one check. `detail` is safe to print. */
export interface Finding {
  /** Stable name of the check. */
  check: string;
  /** True when the check passed. */
  ok: boolean;
  /** What was found, with no secret in it. */
  detail: string;
}

const PEPPER_MIN = 32;
const PII_KEY_BYTES = 32;

/** The events the webhook of the store listens to (FC 012 settlement and FC 069 refunds). */
const REQUIRED_STRIPE_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'charge.refunded',
] as const;

/**
 * The three secrets of the checkout: `CHECKOUT_PII_KEY` is 32 random bytes in canonical base64
 * and each pepper has at least 32 characters (T0.2).
 *
 * @param env - The environment of the API, usually `process.env`.
 * @returns One finding per secret.
 */
export function checkCheckoutSecrets(
  env: Record<string, string | undefined>
): Finding[] {
  const key = env.CHECKOUT_PII_KEY ?? '';
  const decoded = Buffer.from(key, 'base64');
  const keyOk =
    decoded.length === PII_KEY_BYTES && decoded.toString('base64') === key;
  const peppers = ['CUSTOMER_EMAIL_HMAC_PEPPER', 'ORDER_TOKEN_PEPPER'].map(
    (name): Finding => {
      const length = (env[name] ?? '').length;
      return {
        check: name,
        ok: length >= PEPPER_MIN,
        detail:
          length >= PEPPER_MIN
            ? `${length} characters`
            : `needs at least ${PEPPER_MIN} characters, has ${length}`,
      };
    }
  );
  return [
    {
      check: 'CHECKOUT_PII_KEY',
      ok: keyOk,
      detail: keyOk
        ? '32 bytes in base64'
        : 'must be 32 random bytes in canonical base64',
    },
    ...peppers,
  ];
}

/** What Stripe lists for `GET /v1/webhook_endpoints`, reduced to what is checked. */
interface StripeEndpoints {
  data?: { url?: unknown; status?: unknown; enabled_events?: unknown }[];
}

/**
 * The webhook of Stripe: an enabled endpoint at the canonical address that listens to every event
 * of {@link REQUIRED_STRIPE_EVENTS} (or to all of them with `*`). The key needs `Webhooks: read`.
 *
 * @param apiKey - The Stripe key of this environment.
 * @param apiPublicUrl - `API_PUBLIC_URL`, without the path.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns One finding.
 */
export async function checkStripeWebhook(
  apiKey: string,
  apiPublicUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<Finding> {
  const check = 'STRIPE_WEBHOOK_ENDPOINT';
  const expected = `${apiPublicUrl.replace(/\/$/, '')}/v1/webhooks/stripe`;
  let answer: Response;
  try {
    answer = await fetchImpl(
      'https://api.stripe.com/v1/webhook_endpoints?limit=100',
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      }
    );
  } catch {
    return { check, ok: false, detail: 'Stripe could not be reached' };
  }
  if (!answer.ok) {
    return {
      check,
      ok: false,
      detail: `Stripe refused the read (HTTP ${answer.status}); the key needs Webhooks: read`,
    };
  }
  const { data } = (await answer.json()) as StripeEndpoints;
  const endpoint = (data ?? []).find(
    (item) => item.url === expected && item.status === 'enabled'
  );
  if (endpoint === undefined) {
    return {
      check,
      ok: false,
      detail: `no enabled endpoint at ${expected}`,
    };
  }
  const listened: unknown[] = Array.isArray(endpoint.enabled_events)
    ? endpoint.enabled_events
    : [];
  const missing = REQUIRED_STRIPE_EVENTS.filter(
    (event) => !listened.includes(event) && !listened.includes('*')
  );
  return missing.length === 0
    ? {
        check,
        ok: true,
        detail: `enabled at ${expected}, every event listened`,
      }
    : { check, ok: false, detail: `does not listen to ${missing.join(', ')}` };
}

/** The shapes of a real credential; each needs a long tail, so a short test fixture never matches. */
const CREDENTIALS: readonly [string, RegExp][] = [
  ['a Stripe live key', /\b[sr]k_live_[A-Za-z0-9]{20,}/],
  ['a Stripe test key', /\b[sr]k_test_[A-Za-z0-9]{20,}/],
  ['a Stripe webhook secret', /\bwhsec_[A-Za-z0-9]{20,}/],
  ['a Mercado Pago token', /\bAPP_USR-\d{8,}-\d{6}-[0-9a-f]{20,}/],
];

/**
 * Looks for a credential in clear text in the files of the repository.
 *
 * @param files - Path and text of each tracked text file.
 * @returns One finding that lists the paths and the kind of each hit (never the value), and passes
 *   when there are none.
 */
export function scanForSecrets(
  files: readonly { path: string; text: string }[]
): Finding {
  const hits = files.flatMap(({ path, text }) =>
    CREDENTIALS.filter(([, pattern]) => pattern.test(text)).map(
      ([kind]) => `${path}: ${kind}`
    )
  );
  return hits.length === 0
    ? {
        check: 'NO_CREDENTIALS_IN_TREE',
        ok: true,
        detail: `${files.length} files, none holds a credential`,
      }
    : { check: 'NO_CREDENTIALS_IN_TREE', ok: false, detail: hits.join('; ') };
}

/**
 * The report a person reads, one line per finding.
 *
 * @param findings - The findings of every check.
 * @returns The text and whether every check passed.
 */
export function formatReport(findings: readonly Finding[]): {
  text: string;
  ok: boolean;
} {
  const text = findings
    .map(
      ({ check, ok, detail }) => `[${ok ? 'OK' : 'FAIL'}] ${check}: ${detail}`
    )
    .join('\n');
  return { text, ok: findings.every((finding) => finding.ok) };
}
