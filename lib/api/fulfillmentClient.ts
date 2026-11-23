/**
 * Order fulfillment client (FC 068 F1): what the order panel asks
 * `/v1/admin/orders/:order_number/{prepare,ship,deliver}`. Only a session with `orders:manage`
 * gets an answer; the API decides, this client only carries the request.
 *
 * Every request carries credentials (the session cookie) and a fresh `Idempotency-Key`, so a
 * double click or a retried request never applies twice (ADR 0014). Answers are checked against
 * the same schema the API uses (lib/account/fulfillmentTypes.ts). Like the other clients it never
 * throws: offline, a timeout, an answer outside the contract or a refusal become a typed reason,
 * the refusal by its machine code (the problem's `detail`).
 *
 * @module
 */
import {
  fulfillmentResultSchema,
  type ShipRequest,
} from '@/lib/account/fulfillmentTypes';
import { sessionRequest, type TransportFailure } from './http';

/** Hostinger may wake the API from sleep; the first request pays its start-up. */
const TIMEOUT_MS = 25_000;

/** Refusals the panel explains by name. */
const CODES = [
  'ORDER_STATUS_CONFLICT',
  'ORDER_NOT_FOUND',
  'ORDER_PAYLOAD_INVALID',
  'PERMISSION_DENIED',
  'SECOND_FACTOR_REQUIRED',
  'SESSION_INVALID_OR_EXPIRED',
] as const;

/** Why a request gave no usable answer. */
export type FulfillmentFailure =
  (typeof CODES)[number] | 'rate_limited' | 'unknown' | TransportFailure;

/** The refusal of an answer, by its machine code or its status. */
function refusal(status: number, body: unknown): FulfillmentFailure {
  if (status === 429) return 'rate_limited';
  const detail = (body as { detail?: unknown } | undefined)?.detail;
  return CODES.find((code) => code === detail) ?? 'unknown';
}

/** One step with the session cookie and a new Idempotency-Key; `body` only for the shipment. */
function step(
  orderNumber: string,
  name: 'prepare' | 'ship' | 'deliver',
  body: ShipRequest | undefined,
  fetchImpl: typeof fetch
) {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Idempotency-Key': crypto.randomUUID(),
  };
  if (body) headers['Content-Type'] = 'application/json';
  return sessionRequest(
    fetchImpl,
    `/v1/admin/orders/${encodeURIComponent(orderNumber)}/${name}`,
    { method: 'POST', headers, body },
    TIMEOUT_MS,
    fulfillmentResultSchema,
    refusal
  );
}

/**
 * Starts preparing a paid order.
 *
 * @param orderNumber - Public order number.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The order after the change, or why it was refused.
 */
export function prepareOrder(
  orderNumber: string,
  fetchImpl: typeof fetch = fetch
) {
  return step(orderNumber, 'prepare', undefined, fetchImpl);
}

/**
 * Registers the shipment of an order: its carrier, its tracking number and, if there is one, the
 * link to follow it.
 *
 * @param orderNumber - Public order number.
 * @param input - The shipment.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The order after the change, or why it was refused.
 */
export function shipOrder(
  orderNumber: string,
  input: ShipRequest,
  fetchImpl: typeof fetch = fetch
) {
  return step(orderNumber, 'ship', input, fetchImpl);
}

/**
 * Marks a shipped order as delivered.
 *
 * @param orderNumber - Public order number.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The order after the change, or why it was refused.
 */
export function deliverOrder(
  orderNumber: string,
  fetchImpl: typeof fetch = fetch
) {
  return step(orderNumber, 'deliver', undefined, fetchImpl);
}
