/**
 * Client of the point of sale screen (FC 076 F4): the till shift, the cash movements, the products,
 * the sale and its receipt under `/v1/admin/pos`. The API decides every rule; this client only
 * carries the request and names a refusal by its machine code (the problem's `detail`).
 *
 * Every write sends a fresh `Idempotency-Key`, so a double click never opens, moves cash, sells or
 * closes twice. Like the other clients it never throws: offline, a timeout, an answer outside the
 * contract or a refusal become a typed reason.
 *
 * @module
 */
import type { z } from 'zod';
import {
  type cashMovementSchema,
  cashMovementResultSchema,
  closedShiftSchema,
  type closeShiftSchema,
  currentShiftSchema,
  posProductsSchema,
  posSaleResultSchema,
  type posSaleSchema,
  posShiftSchema,
  receiptSchema,
} from '@/lib/account/posTypes';
import { sessionRequest, type TransportFailure } from './http';

/** Hostinger may wake the API from sleep; the first request pays its start-up. */
const TIMEOUT_MS = 25_000;

/** Refusals the screen explains by name. */
const CODES = [
  'POS_SHIFT_ALREADY_OPEN',
  'PERMISSION_DENIED',
  'SHIFT_NOT_OPEN_REJECT',
  'MISSING_DIFF_JUSTIFICATION_REJECT',
  'SUPERVISOR_REQUIRED_FOR_LARGE_DIFF',
  'INSUFFICIENT_DRAWER_CASH_REJECT',
  'SUPERVISOR_PERMISSION_REQUIRED',
  'POS_PRODUCT_UNKNOWN',
  'INSUFFICIENT_STOCK_REJECT',
  'STOCK_RESERVED_ONLINE_REJECT',
  'POS_SHIFT_CLOSED_REJECT',
  'INVALID_POS_METHOD_REJECT',
  'INSUFFICIENT_TENDERED_REJECT',
  'TERMINAL_AMOUNT_MISMATCH_REJECT',
  'INVALID_VOUCHER_DATA_REJECT',
  'INVALID_REQUEST',
  'SERVICE_UNAVAILABLE',
  'SECOND_FACTOR_REQUIRED',
  'SESSION_INVALID_OR_EXPIRED',
] as const;

/** Why a request gave no usable answer. */
export type PosFailure =
  (typeof CODES)[number] | 'rate_limited' | 'unknown' | TransportFailure;

/** The refusal of an answer, by its machine code or its status. */
function refusal(status: number, body: unknown): PosFailure {
  if (status === 429) return 'rate_limited';
  const detail = (body as { detail?: unknown } | undefined)?.detail;
  return CODES.find((code) => code === detail) ?? 'unknown';
}

/** One request with the session cookie; a write carries a new Idempotency-Key. */
function request<T>(
  path: string,
  schema: z.ZodType<T>,
  body: object | undefined,
  fetchImpl: typeof fetch
) {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['Idempotency-Key'] = crypto.randomUUID();
  }
  return sessionRequest(
    fetchImpl,
    `/v1/admin/pos/${path}`,
    { method: body === undefined ? 'GET' : 'POST', headers, body },
    TIMEOUT_MS,
    schema,
    refusal
  );
}

/**
 * The open shift, if any.
 *
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The shift or null, or why it cannot be read.
 */
export function readShift(fetchImpl: typeof fetch = fetch) {
  return request('shifts/current', currentShiftSchema, undefined, fetchImpl);
}

/**
 * Opens the till.
 *
 * @param openingCashMxnCents - The cash the drawer starts with.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The shift, or why it was refused.
 */
export function openTill(
  openingCashMxnCents: number,
  fetchImpl: typeof fetch = fetch
) {
  return request(
    'shifts/open',
    posShiftSchema,
    { openingCashMxnCents },
    fetchImpl
  );
}

/**
 * Puts cash in or takes it out of the drawer.
 *
 * @param movement - Shift, type, amount and reason.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The movement, or why it was refused.
 */
export function moveTillCash(
  movement: z.input<typeof cashMovementSchema>,
  fetchImpl: typeof fetch = fetch
) {
  return request(
    'shifts/movements',
    cashMovementResultSchema,
    movement,
    fetchImpl
  );
}

/**
 * Closes the till with a blind count.
 *
 * @param shiftId - The shift.
 * @param count - The cash counted and, for a difference, the notes.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The count against what was expected, or why it was refused.
 */
export function closeTill(
  shiftId: number,
  count: z.input<typeof closeShiftSchema>,
  fetchImpl: typeof fetch = fetch
) {
  return request(
    `shifts/${shiftId}/close`,
    closedShiftSchema,
    count,
    fetchImpl
  );
}

/**
 * The products of the counter.
 *
 * @param search - Part of a SKU or a name; empty for all.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The products with what is left to sell, or why there are none.
 */
export function listCounterProducts(
  search: string,
  fetchImpl: typeof fetch = fetch
) {
  const trimmed = search.trim();
  const query = trimmed === '' ? '' : `?q=${encodeURIComponent(trimmed)}`;
  return request(`products${query}`, posProductsSchema, undefined, fetchImpl);
}

/**
 * Sells at the counter.
 *
 * @param sale - Lines, payment and, if wanted, the e-mail of the receipt.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The sale, or why it was refused.
 */
export function sell(
  sale: z.input<typeof posSaleSchema>,
  fetchImpl: typeof fetch = fetch
) {
  return request('checkout', posSaleResultSchema, sale, fetchImpl);
}

/**
 * The thermal receipt of a sale.
 *
 * @param orderNumber - The sale.
 * @param widthMm - Paper width.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The lines, or why there are none.
 */
export function readReceipt(
  orderNumber: string,
  widthMm: 80 | 58,
  fetchImpl: typeof fetch = fetch
) {
  return request(
    `orders/${orderNumber}/receipt?width=${widthMm}`,
    receiptSchema,
    undefined,
    fetchImpl
  );
}
