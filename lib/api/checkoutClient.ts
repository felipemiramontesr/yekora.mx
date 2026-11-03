/**
 * Checkout client (FC 012 F3): the browser asks `POST /v1/checkout` to open a payment and
 * `GET /v1/orders/:order_number` to read the order back on the return pages.
 *
 * Like the cart client it never throws: offline, a timeout, a server error or an answer outside
 * the contract become a typed failure. A refusal of the truth tables arrives as its machine code
 * (the problem's `detail`), so the page can say exactly what to fix.
 *
 * @module
 */
import type { Locale } from '@/app/i18n';
import {
  checkoutSessionSchema,
  orderViewSchema,
  type CheckoutRequest,
  type OrderView,
} from '@/lib/checkout/checkoutTypes';
import type { OrderAccess } from '@/lib/checkout/orderAccess';
import { API_URL, call, json, type TransportFailure } from './http';

/** Opening a payment waits on the processor: a wider budget than the cart's 5 s. */
const CHECKOUT_TIMEOUT_MS = 20_000;
const ORDER_TIMEOUT_MS = 8000;

/** Refusals of `POST /v1/checkout` the page explains (T1.1, cart, T1.2 and malformed). */
const CHECKOUT_CODES = [
  'SERVICE_UNAVAILABLE',
  'INVALID_REQUEST',
  'INVALID_SHIPPING_ADDRESS',
  'PRIVACY_CONSENT_REQUIRED',
  'EMPTY_OR_UNAVAILABLE_CART',
  'UNSERVICEABLE_DESTINATION',
  'PRICE_CHANGED',
  'INSUFFICIENT_STOCK',
] as const;

/** Why no payment could be opened. */
export type CheckoutFailure =
  (typeof CHECKOUT_CODES)[number] | TransportFailure;

/** Why an order could not be read; a wrong token and an unknown order are the same 404. */
type OrderFailure = 'not_found' | TransportFailure;

type Session = ReturnType<typeof checkoutSessionSchema.parse>;

/** Injectable fetch, for tests. */
interface ClientOptions {
  fetchImpl?: typeof fetch;
}

/**
 * Opens a payment for the buyer's cart.
 *
 * @param request - The checkout body (validated by the form with the same schema).
 * @param locale - Language of the return pages.
 * @param options - Injectable fetch.
 * @returns The hosted session to go to, or why there is none. Never rejects.
 */
export async function submitCheckout(
  request: CheckoutRequest,
  locale: Locale,
  options: ClientOptions = {}
): Promise<
  { ok: true; session: Session } | { ok: false; reason: CheckoutFailure }
> {
  const { fetchImpl = fetch } = options;
  const answer = await call(
    fetchImpl,
    `${API_URL}/v1/checkout?lang=${locale}`,
    {
      method: 'POST',
      // FC 028 decision 1a: a signed-in buyer's session goes along, so the order joins the account.
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(request),
    },
    CHECKOUT_TIMEOUT_MS
  );
  if (typeof answer === 'string') return { ok: false, reason: answer };
  const body = await json(answer);
  if (answer.status === 201) {
    const parsed = checkoutSessionSchema.safeParse(body);
    return parsed.success
      ? { ok: true, session: parsed.data }
      : { ok: false, reason: 'invalid' };
  }
  const detail = (body as { detail?: unknown } | undefined)?.detail;
  const code = CHECKOUT_CODES.find((known) => known === detail);
  return { ok: false, reason: code ?? 'server' };
}

/**
 * Reads an order with its access token.
 *
 * @param access - Order number and token kept by this tab.
 * @param options - Injectable fetch.
 * @returns The order's status and amounts, or why it could not be read. Never rejects.
 */
export async function fetchOrder(
  access: Pick<OrderAccess, 'orderNumber' | 'accessToken'>,
  options: ClientOptions = {}
): Promise<
  { ok: true; order: OrderView } | { ok: false; reason: OrderFailure }
> {
  const { fetchImpl = fetch } = options;
  const answer = await call(
    fetchImpl,
    `${API_URL}/v1/orders/${encodeURIComponent(access.orderNumber)}`,
    {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${access.accessToken}`,
      },
    },
    ORDER_TIMEOUT_MS
  );
  if (typeof answer === 'string') return { ok: false, reason: answer };
  if (answer.status === 404) return { ok: false, reason: 'not_found' };
  if (!answer.ok) return { ok: false, reason: 'server' };
  const parsed = orderViewSchema.safeParse(await json(answer));
  return parsed.success
    ? { ok: true, order: parsed.data }
    : { ok: false, reason: 'invalid' };
}
