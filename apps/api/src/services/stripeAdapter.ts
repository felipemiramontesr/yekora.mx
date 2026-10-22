/**
 * Stripe adapter (FC 012 F1, ADR 0009): hosted Checkout Sessions for CARD and OXXO, webhook
 * signature verification and reconciliation, with `fetch` against the fixed host
 * https://api.stripe.com (no SDK; OWASP A10).
 *
 * Expiry (T2 «caducidad remota»): the session `expires_at` is the order's deadline minus 30
 * minutes, capped at Stripe's 24 h; Stripe requires at least 30 minutes, so a shorter window
 * is a configuration error and throws. An OXXO voucher lives until 23:59:59 Mexico City time
 * of the day after it is issued (`expires_after_days = 1`); that moment must also fall before
 * the deadline, which the 72-hour OXXO hold guarantees.
 *
 * Webhooks: `Stripe-Signature: t=<unix>,v1=<hex>`, v1 = HMAC-SHA256(secret, `${t}.${rawBody}`),
 * compared in constant time, and `t` must be within 300 s of now.
 *
 * API shapes follow Stripe's public documentation; they are confirmed against a Stripe test
 * account in F2 (no account exists yet, K-26).
 *
 * @module
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  type CreatedSession,
  type PaymentProcessorPort,
  type PaymentStatus,
  PaymentProcessorError,
  remoteDeadline,
  type SessionRequest,
  type VerifiedEvent,
  type WebhookInput,
} from './paymentPort';

const STRIPE_API = 'https://api.stripe.com/v1';
const TIMEOUT_MS = 10_000;
const MIN_SESSION_MS = 30 * 60 * 1000;
const MAX_SESSION_MS = 24 * 60 * 60 * 1000;
const SIGNATURE_TOLERANCE_S = 300;
/** Mexico City has no daylight saving time since 2022: UTC−6 all year. */
const MEXICO_CITY_OFFSET_MS = -6 * 60 * 60 * 1000;

/** Secrets of the Stripe account (test or live, per environment). */
export interface StripeSecrets {
  /** Secret API key (`sk_test_…` / `sk_live_…`). */
  apiKey: string;
  /** Endpoint signing secret of the webhook (`whsec_…`). */
  webhookSecret: string;
}

/** The moment an OXXO voucher issued at `now` stops being payable (23:59:59 CDMX, day + 1). */
function oxxoVoucherEnd(now: Date): Date {
  const local = new Date(now.getTime() + MEXICO_CITY_OFFSET_MS);
  const endLocal = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() + 1,
    23,
    59,
    59
  );
  return new Date(endLocal - MEXICO_CITY_OFFSET_MS);
}

/** Session expiry: deadline minus margin, at most 24 h, at least 30 min, or a config error. */
function sessionExpiry(request: SessionRequest): Date {
  const now = request.now.getTime();
  const latest = Math.min(
    remoteDeadline(request.expiresAt).getTime(),
    now + MAX_SESSION_MS
  );
  if (latest - now < MIN_SESSION_MS) {
    throw new PaymentProcessorError(
      'Stripe: the order hold is too short for a session'
    );
  }
  return new Date(latest);
}

/** Form-encoded body of the Checkout Session (Stripe's API takes form parameters). */
function sessionForm(
  request: SessionRequest,
  expiresAt: Date
): URLSearchParams {
  const form = new URLSearchParams({
    mode: 'payment',
    'payment_method_types[0]': request.method === 'OXXO' ? 'oxxo' : 'card',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'mxn',
    'line_items[0][price_data][unit_amount]': String(request.totalMxnCents),
    'line_items[0][price_data][product_data][name]': request.description,
    client_reference_id: request.orderNumber,
    'metadata[order_number]': request.orderNumber,
    success_url: request.successUrl,
    cancel_url: request.cancelUrl,
    expires_at: String(Math.floor(expiresAt.getTime() / 1000)),
    // Always charge in MXN: Adaptive Pricing would show and settle a foreign buyer's local
    // currency, and reconciliation (T1.3 R) only accepts the exact total in MXN. Sent on every
    // session so a dashboard toggle can never turn it back on.
    'adaptive_pricing[enabled]': 'false',
  });
  if (request.method === 'OXXO') {
    form.set('payment_method_options[oxxo][expires_after_days]', '1');
  }
  return form;
}

function header(
  headers: WebhookInput['headers'],
  name: string
): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** Constant-time comparison of two hex digests of equal length. */
function sameHex(expected: string, given: string): boolean {
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(given, 'hex');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

/**
 * Creates the Stripe adapter.
 *
 * @param secrets - API key and webhook signing secret of this environment.
 * @param fetchImpl - `fetch`, injectable for tests (CI never reaches the network).
 * @returns A {@link PaymentProcessorPort} for CARD and OXXO.
 */
export function createStripeAdapter(
  secrets: StripeSecrets,
  fetchImpl: typeof fetch = fetch
): PaymentProcessorPort {
  async function call(path: string, init: RequestInit): Promise<unknown> {
    const answer = await fetchImpl(`${STRIPE_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${secrets.apiKey}`,
        ...init.headers,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!answer.ok) {
      throw new PaymentProcessorError(`Stripe: HTTP ${answer.status}`);
    }
    return answer.json();
  }

  return {
    async createSession(request): Promise<CreatedSession> {
      if (request.method !== 'CARD' && request.method !== 'OXXO') {
        throw new PaymentProcessorError(
          `Stripe: unsupported method ${request.method}`
        );
      }
      const expiresAt = sessionExpiry(request);
      const remoteExpiresAt =
        request.method === 'OXXO' ? oxxoVoucherEnd(request.now) : expiresAt;
      if (remoteExpiresAt > remoteDeadline(request.expiresAt)) {
        throw new PaymentProcessorError(
          'Stripe: the voucher would outlive the order hold'
        );
      }
      const body = (await call('/checkout/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: sessionForm(request, expiresAt).toString(),
      })) as { id?: unknown; url?: unknown };
      if (typeof body.id !== 'string' || typeof body.url !== 'string') {
        throw new PaymentProcessorError('Stripe: unexpected session answer');
      }
      return { reference: body.id, redirectUrl: body.url, remoteExpiresAt };
    },

    verifyWebhook({ rawBody, headers, now }): VerifiedEvent | null {
      const signature = header(headers, 'stripe-signature') ?? '';
      const parts = signature.split(',').map((part) => part.split('=', 2));
      const timestamp = parts.find(([key]) => key === 't')?.[1] ?? '';
      const candidates = parts
        .filter(([key]) => key === 'v1')
        .map(([, value]) => value ?? '');
      const seconds = Number(timestamp);
      if (
        !/^\d+$/.test(timestamp) ||
        Math.abs(now.getTime() / 1000 - seconds) > SIGNATURE_TOLERANCE_S
      ) {
        return null;
      }
      const expected = createHmac('sha256', secrets.webhookSecret)
        .update(`${timestamp}.`)
        .update(rawBody)
        .digest('hex');
      if (!candidates.some((candidate) => sameHex(expected, candidate)))
        return null;
      let event: {
        id?: unknown;
        type?: unknown;
        data?: { object?: { id?: unknown } };
      };
      try {
        event = JSON.parse(rawBody.toString('utf8')) as typeof event;
      } catch {
        return null;
      }
      if (typeof event.id !== 'string' || typeof event.type !== 'string')
        return null;
      const resource = event.data?.object?.id;
      return {
        eventId: event.id,
        type: event.type,
        resourceId: typeof resource === 'string' ? resource : null,
      };
    },

    async fetchPayment(sessionId): Promise<PaymentStatus> {
      const session = (await call(
        `/checkout/sessions/${encodeURIComponent(sessionId)}`,
        { method: 'GET' }
      )) as {
        payment_status?: unknown;
        amount_total?: unknown;
        currency?: unknown;
        client_reference_id?: unknown;
      };
      const status =
        typeof session.payment_status === 'string'
          ? session.payment_status
          : 'unknown';
      return {
        paid: status === 'paid',
        amountMxnCents: Number.isInteger(session.amount_total)
          ? (session.amount_total as number)
          : null,
        currency:
          typeof session.currency === 'string'
            ? session.currency.toUpperCase()
            : null,
        orderNumber:
          typeof session.client_reference_id === 'string'
            ? session.client_reference_id
            : null,
        processorStatus: status,
      };
    },
  };
}
