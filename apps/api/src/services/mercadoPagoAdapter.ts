/**
 * Mercado Pago adapter (FC 012 F1, ADR 0009): Checkout Pro preferences for SPEI and Mercado
 * Pago balance, webhook signature verification and reconciliation, with `fetch` against the
 * fixed host https://api.mercadopago.com (no SDK; OWASP A10).
 *
 * One method per preference (Ω, 112_AN): every other payment type is excluded, so the hosted
 * page offers only what the buyer chose in Yekora. Mercado Pago Mexico refuses to exclude its
 * own balance (`account_money`), so a SPEI page also offers it (FC 019 T1.3, 181_AN): the
 * payment is reconciled by status, amount, currency and reference, never by type, so either
 * way pays the order. Expiry (T2): the preference and the payment
 * (`expiration_date_to`, `date_of_expiration`) end at the order's deadline minus 30 minutes.
 * Amounts go out as pesos with two decimals and come back as cents, rounded.
 *
 * Webhooks: `x-signature: ts=<ts>,v1=<hex>` with `x-request-id`; v1 = HMAC-SHA256(secret,
 * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`), where data.id comes from the query
 * string (lower-cased), compared in constant time.
 *
 * API shapes follow Mercado Pago's public documentation, confirmed against the client's test
 * account in FC 019 F2 (a balance payment paid an order end to end, webhook signature included).
 *
 * Account check at startup (FC 019): test and live tokens may both start with `APP_USR-`, so
 * `GET /users/me` decides. A test account carries the `test_user` tag (confirmed with the
 * client's test token, H 19:20:39). Any doubt (network, HTTP error, no tags) fails closed.
 *
 * @module
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  type CreatedSession,
  type PaymentMethodCode,
  type PaymentProcessorPort,
  type PaymentStatus,
  PaymentProcessorError,
  remoteDeadline,
  type VerifiedEvent,
  type WebhookInput,
} from './paymentPort';

const MP_API = 'https://api.mercadopago.com';
const TIMEOUT_MS = 10_000;

/** Payment types of Mercado Pago in Mexico; those a method allows are the only ones not excluded. */
const PAYMENT_TYPES = [
  'credit_card',
  'debit_card',
  'prepaid_card',
  'ticket',
  'atm',
  'bank_transfer',
  'account_money',
  'digital_currency',
] as const;

/**
 * The Mercado Pago payment types each Yekora method leaves open (FC 019 T1.3): its own type,
 * plus `account_money`, which Mercado Pago Mexico never lets a preference exclude.
 */
const ALLOWED_TYPES: Partial<
  Record<PaymentMethodCode, readonly (typeof PAYMENT_TYPES)[number][]>
> = {
  SPEI: ['bank_transfer', 'account_money'],
  MERCADO_PAGO_BALANCE: ['account_money'],
};

/** Secrets of the Mercado Pago application (test or production, per environment). */
export interface MercadoPagoSecrets {
  /** Access token (`TEST-…` / `APP_USR-…`). */
  accessToken: string;
  /** Secret key that signs the webhooks. */
  webhookSecret: string;
}

/**
 * Whether the token's account is a Mercado Pago test account, or null when Mercado Pago cannot
 * say (unreachable, HTTP error, or an answer without tags). Never reveals the token.
 */
async function isTestAccount(
  accessToken: string,
  fetchImpl: typeof fetch
): Promise<boolean | null> {
  try {
    const answer = await fetchImpl(`${MP_API}/users/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!answer.ok) return null;
    const { tags } = (await answer.json()) as { tags?: unknown };
    return Array.isArray(tags) ? tags.includes('test_user') : null;
  } catch {
    return null;
  }
}

/**
 * Refuses to go on unless the token belongs to a Mercado Pago test account (FC 019 T1.1 V).
 *
 * @param accessToken - Sandbox token starting with `APP_USR-`.
 * @param fetchImpl - `fetch`, injectable for tests (CI never reaches the network).
 * @throws `UNVERIFIED_MP_TEST_ACCOUNT` when the account is not a test one or cannot be checked.
 */
export async function verifyMercadoPagoTestAccount(
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  if ((await isTestAccount(accessToken, fetchImpl)) !== true) {
    throw new Error(
      'UNVERIFIED_MP_TEST_ACCOUNT: the Mercado Pago account is not a verified test account'
    );
  }
}

/**
 * Refuses to go on unless the token belongs to a real (non-test) Mercado Pago account (FC 019
 * T1.2 V).
 *
 * @param accessToken - Live token (`APP_USR-…`).
 * @param fetchImpl - `fetch`, injectable for tests (CI never reaches the network).
 * @throws `TEST_ACCOUNT_REJECTED_IN_LIVE` when the account is a test one or cannot be checked.
 */
export async function verifyMercadoPagoLiveAccount(
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  if ((await isTestAccount(accessToken, fetchImpl)) !== false) {
    throw new Error(
      'TEST_ACCOUNT_REJECTED_IN_LIVE: the Mercado Pago account is a test account or cannot be checked'
    );
  }
}

function header(headers: WebhookInput['headers'], name: string): string {
  const value = headers[name];
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/**
 * Creates the Mercado Pago adapter.
 *
 * @param secrets - Access token and webhook secret of this environment.
 * @param fetchImpl - `fetch`, injectable for tests (CI never reaches the network).
 * @returns A {@link PaymentProcessorPort} for SPEI and Mercado Pago balance.
 */
export function createMercadoPagoAdapter(
  secrets: MercadoPagoSecrets,
  fetchImpl: typeof fetch = fetch
): PaymentProcessorPort {
  async function call(path: string, init: RequestInit): Promise<unknown> {
    const answer = await fetchImpl(`${MP_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${secrets.accessToken}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!answer.ok) {
      throw new PaymentProcessorError(`Mercado Pago: HTTP ${answer.status}`);
    }
    return answer.json();
  }

  return {
    async createSession(request): Promise<CreatedSession> {
      const allowed = ALLOWED_TYPES[request.method];
      if (allowed === undefined) {
        throw new PaymentProcessorError(
          `Mercado Pago: unsupported method ${request.method}`
        );
      }
      const remoteExpiresAt = remoteDeadline(request.expiresAt);
      if (remoteExpiresAt <= request.now) {
        throw new PaymentProcessorError(
          'Mercado Pago: the order hold is too short'
        );
      }
      const until = remoteExpiresAt.toISOString();
      const body = (await call('/checkout/preferences', {
        method: 'POST',
        body: JSON.stringify({
          items: [
            {
              id: request.orderNumber,
              title: request.description,
              quantity: 1,
              currency_id: 'MXN',
              unit_price: request.totalMxnCents / 100,
            },
          ],
          external_reference: request.orderNumber,
          back_urls: {
            success: request.successUrl,
            pending: request.successUrl,
            failure: request.cancelUrl,
          },
          auto_return: 'approved',
          notification_url: request.notificationUrl,
          expires: true,
          expiration_date_from: request.now.toISOString(),
          expiration_date_to: until,
          date_of_expiration: until,
          payment_methods: {
            excluded_payment_types: PAYMENT_TYPES.filter(
              (t) => !allowed.includes(t)
            ).map((id) => ({ id })),
            installments: 1,
          },
        }),
      })) as { id?: unknown; init_point?: unknown };
      if (typeof body.id !== 'string' || typeof body.init_point !== 'string') {
        throw new PaymentProcessorError(
          'Mercado Pago: unexpected preference answer'
        );
      }
      return {
        reference: body.id,
        redirectUrl: body.init_point,
        remoteExpiresAt,
      };
    },

    verifyWebhook({ rawBody, headers, query }): VerifiedEvent | null {
      const parts = header(headers, 'x-signature')
        .split(',')
        .map((part) => part.trim().split('=', 2));
      const ts = parts.find(([key]) => key === 'ts')?.[1] ?? '';
      const given = parts.find(([key]) => key === 'v1')?.[1] ?? '';
      const requestId = header(headers, 'x-request-id');
      const dataId = (query['data.id'] ?? '').toLowerCase();
      if (ts === '' || requestId === '' || dataId === '') return null;
      const expected = createHmac('sha256', secrets.webhookSecret)
        .update(`id:${dataId};request-id:${requestId};ts:${ts};`)
        .digest();
      const received = Buffer.from(given, 'hex');
      if (
        received.length !== expected.length ||
        !timingSafeEqual(received, expected)
      ) {
        return null;
      }
      let event: { id?: unknown; type?: unknown; action?: unknown };
      try {
        event = JSON.parse(rawBody.toString('utf8')) as typeof event;
      } catch {
        return null;
      }
      let type = 'unknown';
      if (typeof event.type === 'string') type = event.type;
      else if (typeof event.action === 'string') type = event.action;
      // The notification id identifies the delivery of this event; without one, the payment id
      // plus the action is the most stable key the body offers.
      const eventId =
        typeof event.id === 'string' || typeof event.id === 'number'
          ? String(event.id)
          : `${type}:${dataId}`;
      return { eventId, type, resourceId: dataId };
    },

    async fetchPayment(paymentId): Promise<PaymentStatus> {
      const payment = (await call(
        `/v1/payments/${encodeURIComponent(paymentId)}`,
        {
          method: 'GET',
        }
      )) as {
        status?: unknown;
        transaction_amount?: unknown;
        currency_id?: unknown;
        external_reference?: unknown;
      };
      const status =
        typeof payment.status === 'string' ? payment.status : 'unknown';
      const amount =
        typeof payment.transaction_amount === 'number' &&
        Number.isFinite(payment.transaction_amount)
          ? Math.round(payment.transaction_amount * 100)
          : null;
      return {
        paid: status === 'approved',
        amountMxnCents: amount,
        currency:
          typeof payment.currency_id === 'string'
            ? payment.currency_id.toUpperCase()
            : null,
        orderNumber:
          typeof payment.external_reference === 'string'
            ? payment.external_reference
            : null,
        processorStatus: status,
      };
    },
  };
}
