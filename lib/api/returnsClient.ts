/**
 * Client of the returns screens (FC 073 F0, K-80 second part): what the buyer's order page and
 * the panel's board ask of `/v1/account/orders/:order_number/returns` and `/v1/admin/returns`. The
 * API (FC 071) decides every rule; this client only carries the request and names the refusal.
 *
 * The two writes that ask for an `Idempotency-Key` (a request and a preparation) send a fresh one
 * each call, so a double click or a retried request never applies twice (T2.2, ADR 0014); the
 * confirmation sends none, because its stage machine and the key it sends to the processor
 * already make it safe to repeat. Answers are checked against the shared contract
 * (lib/account/returnTypes.ts). Like the other clients it never throws: offline, a timeout, an
 * answer outside the contract or a refusal become a typed reason, the refusal by its machine code
 * (the problem's `detail`).
 *
 * @module
 */
import type { z } from 'zod';
import {
  returnListSchema,
  type posReturnRequestSchema,
  type returnConfirmRequestSchema,
  type returnPrepareRequestSchema,
  type returnRequestSchema,
  returnSchema,
} from '@/lib/account/returnTypes';
import { sessionRequest, type TransportFailure } from './http';

/** Hostinger may wake the API from sleep; the first request pays its start-up. */
const TIMEOUT_MS = 25_000;

/** Refusals the screens explain by name (FC 071 codes, without their HTTP suffix). */
const CODES = [
  'DATA_DOMAIN_FORBIDDEN',
  'ORDER_NOT_FOUND',
  'ORDER_NOT_DELIVERED_REJECT',
  'WINDOW_EXPIRED_REJECT',
  'PRODUCT_NON_RETURNABLE_REJECT',
  'INVALID_QUANTITY_REJECT',
  'RETURN_PAYLOAD_INVALID',
  'RETURN_NOT_FOUND',
  'RETURN_STATUS_CONFLICT',
  'RETURN_NOT_PREPARED_REJECT',
  'UNAUTHORIZED_CONFIRMER_REJECT',
  'DUAL_CONTROL_VIOLATION_REJECT',
  'INVALID_REFUND_AMOUNT_REJECT',
  'MANUAL_REFERENCE_REQUIRED',
  'REFUND_PROCESSOR_UNAVAILABLE',
  'REFUND_PROCESSOR_ERROR',
  'REFUND_METHOD_REQUIRED',
  'POS_SHIFT_CLOSED_REJECT',
  'INSUFFICIENT_DRAWER_CASH_REJECT',
  'IDEMP_KEY_MISSING',
  'IDEMP_KEY_INVALID',
  'PERMISSION_DENIED',
  'SECOND_FACTOR_REQUIRED',
  'SESSION_INVALID_OR_EXPIRED',
] as const;

/** Why a request gave no usable answer. */
export type ReturnsFailure =
  (typeof CODES)[number] | 'rate_limited' | 'unknown' | TransportFailure;

/** The refusal of an answer, by its machine code or its status. */
function refusal(status: number, body: unknown): ReturnsFailure {
  if (status === 429) return 'rate_limited';
  const detail = (body as { detail?: unknown } | undefined)?.detail;
  return CODES.find((code) => code === detail) ?? 'unknown';
}

/** One request with the session cookie; a write may carry a new Idempotency-Key. */
function request<T>(
  path: string,
  schema: z.ZodType<T>,
  method: 'GET' | 'POST',
  body: object | undefined,
  options: { idempotent: boolean },
  fetchImpl: typeof fetch
) {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (options.idempotent) headers['Idempotency-Key'] = crypto.randomUUID();
  return sessionRequest(
    fetchImpl,
    path,
    { method, headers, body },
    TIMEOUT_MS,
    schema,
    refusal
  );
}

/**
 * Asks to return units of a delivered order; only the order's buyer may.
 *
 * @param orderNumber - Public number of the order, `YEK-AAAA-XXXXXXXX`.
 * @param input - The lines (SKU and units), the reason and an optional comment.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The request as the board will show it, or why it was refused.
 */
export function requestReturn(
  orderNumber: string,
  input: z.input<typeof returnRequestSchema>,
  fetchImpl: typeof fetch = fetch
) {
  return request(
    `/v1/account/orders/${orderNumber}/returns`,
    returnSchema,
    'POST',
    input,
    { idempotent: true },
    fetchImpl
  );
}

/**
 * The board: up to 200 requests, newest first, every stage or just one.
 *
 * @param status - One stage to show, or undefined for all of them.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The requests and the total of the filter, or why there are none.
 */
export function listReturns(
  status: z.infer<typeof returnSchema>['status'] | undefined,
  fetchImpl: typeof fetch = fetch
) {
  const query = status === undefined ? '' : `?status=${status}`;
  return request(
    `/v1/admin/returns${query}`,
    returnListSchema,
    'GET',
    undefined,
    { idempotent: false },
    fetchImpl
  );
}

/**
 * Prepares the refund of a request: the amount and whether the units go back to the shelf.
 *
 * @param id - The request.
 * @param input - Amount in cents and restock choice.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The request after the preparation, or why it was refused.
 */
export function prepareReturn(
  id: number,
  input: z.input<typeof returnPrepareRequestSchema>,
  fetchImpl: typeof fetch = fetch
) {
  return request(
    `/v1/admin/returns/${id}/prepare`,
    returnSchema,
    'POST',
    input,
    { idempotent: true },
    fetchImpl
  );
}

/**
 * Confirms a prepared refund; someone other than who prepared it, and a refund made by hand at
 * Mercado Pago names its reference.
 *
 * @param id - The request.
 * @param input - The manual reference, if the refund was made by hand.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The request after the confirmation, or why it was refused.
 */
export function confirmReturn(
  id: number,
  input: z.input<typeof returnConfirmRequestSchema>,
  fetchImpl: typeof fetch = fetch
) {
  return request(
    `/v1/admin/returns/${id}/confirm`,
    returnSchema,
    'POST',
    input,
    { idempotent: false },
    fetchImpl
  );
}

/**
 * The staff asks for the return of a counter sale (FC 076), with a fresh Idempotency-Key.
 *
 * @param input - Order number, lines, reason and an optional comment.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The request as the board shows it, or why it was refused.
 */
export function requestCounterReturn(
  input: z.input<typeof posReturnRequestSchema>,
  fetchImpl: typeof fetch = fetch
) {
  return request(
    '/v1/admin/returns/pos',
    returnSchema,
    'POST',
    input,
    { idempotent: true },
    fetchImpl
  );
}
