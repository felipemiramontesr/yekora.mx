/**
 * Shipping console client (FC 061 F1): what `{area}envios/` asks `/v1/admin/shipping`. Only a
 * session with `shipping:manage` gets an answer; the API decides, this client only carries the
 * request.
 *
 * Every request carries credentials (the session cookie), and every write a fresh
 * `Idempotency-Key`, so a double click or a retried request never applies twice (ADR 0014).
 * Answers are checked against the same schemas the API uses (lib/account/shippingAdminTypes.ts).
 * Like the other clients it never throws: offline, a timeout, an answer outside the contract or
 * a refusal become a typed reason, the refusal by its machine code (the problem's `detail`).
 *
 * @module
 */
import {
  type ShippingConfigRequest,
  type ShippingRulesRequest,
  shippingAdminViewSchema,
} from '@/lib/account/shippingAdminTypes';
import { sessionRequest, type TransportFailure } from './http';

/** Hostinger may wake the API from sleep; the first request pays its start-up. */
const TIMEOUT_MS = 25_000;

/** Refusals the console explains by name. */
const CODES = [
  'SHIPPING_STRATEGY_UNAVAILABLE',
  'SHIPPING_ZONE_UNKNOWN',
  'PERMISSION_DENIED',
  'SECOND_FACTOR_REQUIRED',
  'INVALID_REQUEST',
  'SESSION_INVALID_OR_EXPIRED',
] as const;

/** Why a request gave no usable answer. */
export type ShippingAdminFailure =
  (typeof CODES)[number] | 'rate_limited' | 'unknown' | TransportFailure;

/** The refusal of an answer, by its machine code or its status. */
function refusal(status: number, body: unknown): ShippingAdminFailure {
  if (status === 429) return 'rate_limited';
  const detail = (body as { detail?: unknown } | undefined)?.detail;
  return CODES.find((code) => code === detail) ?? 'unknown';
}

/** One request with the session cookie; a write carries a new Idempotency-Key. */
function request(
  path: string,
  method: 'GET' | 'PUT',
  body: object | undefined,
  fetchImpl: typeof fetch
) {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body) {
    headers['Idempotency-Key'] = crypto.randomUUID();
    headers['Content-Type'] = 'application/json';
  }
  return sessionRequest(
    fetchImpl,
    path,
    { method, headers, body },
    TIMEOUT_MS,
    shippingAdminViewSchema,
    refusal
  );
}

/**
 * The shipping configuration, its catalogs and the rate of each state.
 *
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The view, or why there is none.
 */
export function readShippingAdmin(fetchImpl: typeof fetch = fetch) {
  return request('/v1/admin/shipping', 'GET', undefined, fetchImpl);
}

/**
 * Sets the active strategy and free shipping.
 *
 * @param input - The configuration.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The view after the change, or why it was refused.
 */
export function saveShippingConfig(
  input: ShippingConfigRequest,
  fetchImpl: typeof fetch = fetch
) {
  return request('/v1/admin/shipping/config', 'PUT', input, fetchImpl);
}

/**
 * Replaces the rate of the 32 states.
 *
 * @param input - One rate for each state.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The view after the change, or why it was refused.
 */
export function saveShippingRules(
  input: ShippingRulesRequest,
  fetchImpl: typeof fetch = fetch
) {
  return request('/v1/admin/shipping/rules', 'PUT', input, fetchImpl);
}
