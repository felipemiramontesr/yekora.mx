/**
 * Client of the saved cards of an account (FC 054 F1): what `/cuenta/metodos-pago/` asks
 * `/v1/account/payment-methods`. The API decides and Stripe holds the cards; this client only
 * carries the request and never sees a card number, a security code or a holder name.
 *
 * Every request carries credentials (the session cookie), and every write a fresh
 * `Idempotency-Key`, so a double click or a retried request never applies twice (ADR 0014).
 * Answers are checked against the schemas the API uses (lib/account/paymentMethodTypes.ts). Like
 * the other clients it never throws: offline, a timeout, an answer outside the contract or a
 * refusal become a typed reason, the refusal by its machine code (the problem's `detail`).
 *
 * @module
 */
import type { z } from 'zod';
import {
  paymentMethodDetachResponseSchema,
  paymentMethodListResponseSchema,
  paymentMethodSettleResponseSchema,
  paymentMethodSetupResponseSchema,
} from '@/lib/account/paymentMethodTypes';
import { sessionRequest, type TransportFailure } from './http';

/** Hostinger may wake the API from sleep, and Stripe may take a moment: the same patience as elsewhere. */
const TIMEOUT_MS = 25_000;

/** Refusals the page explains by name. */
const CODES = [
  'CARD_ATTACH_FAILED',
  'GATEWAY_DETACH_FAILED',
  'PAYMENT_METHOD_NOT_FOUND',
  'SERVICE_UNAVAILABLE',
  'SESSION_INVALID_OR_EXPIRED',
] as const;

/** Why a request gave no usable answer. */
export type PaymentMethodsFailure =
  (typeof CODES)[number] | 'rate_limited' | 'unknown' | TransportFailure;

/** The refusal of an answer, by its machine code or its status. */
function refusal(status: number, body: unknown): PaymentMethodsFailure {
  if (status === 429) return 'rate_limited';
  const detail = (body as { detail?: unknown } | undefined)?.detail;
  return CODES.find((code) => code === detail) ?? 'unknown';
}

/** One request with the session cookie; a write carries a new Idempotency-Key. */
function request<T>(
  path: string,
  schema: z.ZodType<T>,
  method: 'GET' | 'POST' | 'DELETE',
  fetchImpl: typeof fetch
) {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') headers['Idempotency-Key'] = crypto.randomUUID();
  return sessionRequest(
    fetchImpl,
    path,
    { method, headers },
    TIMEOUT_MS,
    schema,
    refusal
  );
}

/**
 * The cards the account keeps at Stripe: brand, last four digits and expiry, nothing else.
 *
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The cards and whether the account has a customer at Stripe yet, or why not.
 */
export function listPaymentMethods(fetchImpl: typeof fetch = fetch) {
  return request(
    '/v1/account/payment-methods',
    paymentMethodListResponseSchema,
    'GET',
    fetchImpl
  );
}

/**
 * Asks for Stripe's hosted page where the person enters a card; they come back to the page of the
 * cards afterwards.
 *
 * @param lang - Language of the page the person returns to.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The address of Stripe's page, or why it could not be opened.
 */
export function startPaymentMethodSetup(
  lang: 'es-MX' | 'en',
  fetchImpl: typeof fetch = fetch
) {
  return request(
    `/v1/account/payment-methods/setup?lang=${lang}`,
    paymentMethodSetupResponseSchema,
    'POST',
    fetchImpl
  );
}

/**
 * Detaches a card of the account at Stripe.
 *
 * @param id - Stripe's id of the card (`pm_…`).
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns `{ detached: true }`, or why it was refused (another account's card is a 404 too).
 */
export function detachPaymentMethod(
  id: string,
  fetchImpl: typeof fetch = fetch
) {
  return request(
    `/v1/account/payment-methods/${id}`,
    paymentMethodDetachResponseSchema,
    'DELETE',
    fetchImpl
  );
}

/**
 * Leaves the account with one card (FC 057): the newest one at Stripe stays and the older ones are
 * detached. The page asks it when Stripe sends the person back after adding a card, and when it
 * finds more than one.
 *
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The card kept and whether it was `saved` or `replaced` another, or why it was refused.
 */
export function settlePaymentMethods(fetchImpl: typeof fetch = fetch) {
  return request(
    '/v1/account/payment-methods/settle',
    paymentMethodSettleResponseSchema,
    'POST',
    fetchImpl
  );
}
