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
 * API shapes follow Stripe's public documentation and were confirmed against the client's Stripe
 * sandbox in F5, under the pinned {@link STRIPE_VERSION}.
 *
 * @module
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  type CreatedSession,
  type PaymentProcessorPort,
  type PaymentStatus,
  type RefundStatus,
  PaymentProcessorError,
  remoteDeadline,
  type SessionRequest,
  type VerifiedEvent,
  type WebhookInput,
} from './paymentPort';

const STRIPE_API = 'https://api.stripe.com/v1';
/**
 * API version pinned on every call, so the account's default can never change the shapes this
 * adapter relies on. Version 2026-09-30 dropped `payment_method_types` on Checkout Sessions and
 * refused every session (FC 012 F5); 2026-03-25.dahlia still takes it for card and OXXO.
 */
const STRIPE_VERSION = '2026-03-25.dahlia';
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
  // FC 054 T1.3: a buyer who asked to keep the card pays as the customer of their account, and
  // Stripe ties the card to it when the charge succeeds.
  if (
    request.method === 'CARD' &&
    request.futureUsageCustomerId !== undefined
  ) {
    form.set('customer', request.futureUsageCustomerId);
    form.set('payment_intent_data[setup_future_usage]', 'off_session');
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
 * One call to Stripe, always against the fixed host, with the pinned version and a timeout.
 *
 * @param secrets - API key of this environment.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @param path - Path under `https://api.stripe.com/v1`.
 * @param init - Method, headers and body.
 * @returns The parsed answer; rejects with {@link PaymentProcessorError} on any non-2xx status.
 */
/**
 * What Stripe said about a refusal: its error type, code and the parameter it objected to, such as
 * `invalid_request_error parameter_invalid_empty success_url`. Its free-text message is left out on
 * purpose (it can echo part of a key), and nothing of ours or of a card is ever in these three.
 *
 * @param answer - The refused response.
 * @returns The words, or an empty string when the body is not Stripe's error shape.
 */
async function refusalReason(answer: Response): Promise<string> {
  const body = (await answer.json().catch(() => null)) as {
    error?: Record<string, unknown>;
  } | null;
  const error = body?.error;
  if (typeof error !== 'object' || error === null) return '';
  return [error.type, error.code, error.param]
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .join(' ');
}

async function stripeCall(
  secrets: StripeSecrets,
  fetchImpl: typeof fetch,
  path: string,
  init: RequestInit
): Promise<unknown> {
  const answer = await fetchImpl(`${STRIPE_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secrets.apiKey}`,
      'Stripe-Version': STRIPE_VERSION,
      ...init.headers,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!answer.ok) {
    const reason = await refusalReason(answer);
    const said = reason === '' ? '' : ' (' + reason + ')';
    throw new PaymentProcessorError(
      `Stripe: HTTP ${answer.status}${said}`,
      answer.status
    );
  }
  return answer.json();
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
  const call = (path: string, init: RequestInit) =>
    stripeCall(secrets, fetchImpl, path, init);

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

    async fetchRefund(chargeId): Promise<RefundStatus | null> {
      // The event carries a charge (`ch_…`); only its payment intent (`pi_…`) finds the session.
      const charge = (await call(`/charges/${encodeURIComponent(chargeId)}`, {
        method: 'GET',
      })) as {
        payment_intent?: unknown;
        amount?: unknown;
        amount_refunded?: unknown;
        currency?: unknown;
      };
      if (
        typeof charge.payment_intent !== 'string' ||
        !Number.isInteger(charge.amount) ||
        !Number.isInteger(charge.amount_refunded)
      ) {
        return null;
      }
      const found = (await call(
        `/checkout/sessions?payment_intent=${encodeURIComponent(charge.payment_intent)}&limit=1`,
        { method: 'GET' }
      )) as { data?: { id?: unknown; client_reference_id?: unknown }[] };
      const session = found.data?.[0];
      if (typeof session?.id !== 'string') return null;
      return {
        sessionId: session.id,
        orderNumber:
          typeof session.client_reference_id === 'string'
            ? session.client_reference_id
            : null,
        amountMxnCents: charge.amount as number,
        refundedMxnCents: charge.amount_refunded as number,
        currency:
          typeof charge.currency === 'string'
            ? charge.currency.toUpperCase()
            : null,
      };
    },
  };
}

/** The card facts Stripe gives back, and nothing else (FC 054 T2.1). */
interface StripeCard {
  /** Stripe's id of the card (`pm_…`). */
  id: string;
  /** Brand as Stripe names it. */
  brand: string;
  /** Last four digits. */
  last4: string;
  /** Month of expiry. */
  expMonth: number;
  /** Year of expiry. */
  expYear: number;
  /** When Stripe attached it, in seconds since 1970: the newest card is the one an account keeps. */
  created: number;
}

/** What the account area needs from Stripe to keep cards for later purchases (FC 054). */
export interface StripeCardsPort {
  /**
   * Creates the Stripe customer of an account. Retrying with the same account gives back the same
   * customer (Stripe's idempotency), so two requests never leave two customers.
   *
   * @param userId - Id of the account, kept as the customer's reference (no name, no e-mail).
   * @returns The customer id (`cus_…`).
   */
  createCustomer(userId: string): Promise<string>;
  /**
   * Lists the cards of a customer.
   *
   * @param customerId - Stripe customer.
   * @returns Brand, last four and expiry of each card.
   */
  listCards(customerId: string): Promise<StripeCard[]>;
  /**
   * Says which customer a card belongs to.
   *
   * @param paymentMethodId - Stripe id of the card.
   * @returns The customer id, or null when the card does not exist or is not attached to anyone.
   */
  cardOwner(paymentMethodId: string): Promise<string | null>;
  /**
   * Detaches a card from its customer.
   *
   * @param paymentMethodId - Stripe id of the card.
   */
  detachCard(paymentMethodId: string): Promise<void>;
  /**
   * Opens the hosted page where the person enters a card, to keep it for later purchases.
   *
   * @param input - Customer and the pages Stripe returns the person to.
   * @returns The address of the hosted page.
   */
  createSetupSession(input: {
    customerId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<string>;
}

/** The string, or null when it is anything else. */
const textOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/**
 * Creates the saved-cards client of Stripe (FC 054): `fetch` against the fixed host, no SDK. The
 * card number and the security code never pass through here: the person types them on Stripe's
 * hosted page, and only brand, last four and expiry come back, to be shown and forgotten.
 *
 * @param secrets - API key of this environment.
 * @param fetchImpl - `fetch`, injectable for tests (CI never reaches the network).
 * @returns A {@link StripeCardsPort}.
 */
export function createStripeCards(
  secrets: StripeSecrets,
  fetchImpl: typeof fetch = fetch
): StripeCardsPort {
  const call = (path: string, init: RequestInit) =>
    stripeCall(secrets, fetchImpl, path, init);
  const form = { 'Content-Type': 'application/x-www-form-urlencoded' };

  return {
    async createCustomer(userId) {
      const body = (await call('/customers', {
        method: 'POST',
        headers: { ...form, 'Idempotency-Key': `yekora-customer-${userId}` },
        body: new URLSearchParams({ 'metadata[user_id]': userId }).toString(),
      })) as { id?: unknown };
      const id = textOrNull(body.id);
      if (id === null) {
        throw new PaymentProcessorError('Stripe: unexpected customer answer');
      }
      return id;
    },

    async listCards(customerId) {
      const body = (await call(
        `/customers/${encodeURIComponent(customerId)}/payment_methods?type=card&limit=100`,
        { method: 'GET' }
      )) as { data?: unknown };
      const rows = Array.isArray(body.data) ? body.data : [];
      return rows.flatMap((row: unknown) => {
        const method = row as {
          id?: unknown;
          created?: unknown;
          card?: Record<string, unknown>;
        };
        const id = textOrNull(method.id);
        const brand = textOrNull(method.card?.brand);
        const last4 = textOrNull(method.card?.last4);
        const month = method.card?.exp_month;
        const year = method.card?.exp_year;
        return id !== null &&
          brand !== null &&
          last4 !== null &&
          Number.isInteger(month) &&
          Number.isInteger(year)
          ? [
              {
                id,
                brand,
                last4,
                expMonth: month as number,
                expYear: year as number,
                created: Number.isInteger(method.created)
                  ? (method.created as number)
                  : 0,
              },
            ]
          : [];
      });
    },

    async cardOwner(paymentMethodId) {
      try {
        const body = (await call(
          `/payment_methods/${encodeURIComponent(paymentMethodId)}`,
          { method: 'GET' }
        )) as { customer?: unknown };
        return textOrNull(body.customer);
      } catch (error) {
        // A card that does not exist is not an error of ours: it simply belongs to no one.
        if (error instanceof PaymentProcessorError && error.status === 404) {
          return null;
        }
        throw error;
      }
    },

    async detachCard(paymentMethodId) {
      await call(
        `/payment_methods/${encodeURIComponent(paymentMethodId)}/detach`,
        { method: 'POST', headers: form, body: '' }
      );
    },

    async createSetupSession({ customerId, successUrl, cancelUrl }) {
      const body = (await call('/checkout/sessions', {
        method: 'POST',
        headers: form,
        body: new URLSearchParams({
          mode: 'setup',
          currency: 'mxn',
          customer: customerId,
          'payment_method_types[0]': 'card',
          success_url: successUrl,
          cancel_url: cancelUrl,
        }).toString(),
      })) as { url?: unknown };
      const url = textOrNull(body.url);
      if (url === null) {
        throw new PaymentProcessorError('Stripe: unexpected setup answer');
      }
      return url;
    },
  };
}
