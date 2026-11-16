/**
 * Client of the data an account keeps (FC 051): what `/cuenta/datos` asks `/v1/account/profile`
 * and `/v1/account/addresses`. The API decides; this client only carries the request.
 *
 * Every request carries credentials (the session cookie), and every write a fresh
 * `Idempotency-Key`, so a double click or a retried request never applies twice (ADR 0014).
 * Answers are checked against the same schemas the API uses (lib/account/addressTypes.ts). Like the
 * other clients it never throws: offline, a timeout, an answer outside the contract or a refusal
 * become a typed reason, the refusal by its machine code (the problem's `detail`).
 *
 * @module
 */
import { z } from 'zod';
import {
  type addressPatchRequestSchema,
  type addressUpsertRequestSchema,
  addressListSchema,
  addressSavedSchema,
  type profileUpdateRequestSchema,
  profileUpdatedSchema,
} from '@/lib/account/addressTypes';
import { sessionRequest, type TransportFailure } from './http';

/** Hostinger may wake the API from sleep; the first request pays its start-up. */
const TIMEOUT_MS = 25_000;

/** Refusals the page explains by name. */
const CODES = [
  'INVALID_REQUEST',
  'INVALID_ADDRESS',
  'ADDRESS_NOT_FOUND',
  'ADDRESS_LIMIT_REACHED',
  'SERVICE_UNAVAILABLE',
  'SESSION_INVALID_OR_EXPIRED',
] as const;

/** Why a request gave no usable answer. */
export type AccountDataFailure =
  (typeof CODES)[number] | 'rate_limited' | 'unknown' | TransportFailure;

/** The refusal of an answer, by its machine code or its status. */
function refusal(status: number, body: unknown): AccountDataFailure {
  if (status === 429) return 'rate_limited';
  const detail = (body as { detail?: unknown } | undefined)?.detail;
  return CODES.find((code) => code === detail) ?? 'unknown';
}

/** One request with the session cookie; a write carries a new Idempotency-Key. */
function request<T>(
  path: string,
  schema: z.ZodType<T>,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  body: object | undefined,
  fetchImpl: typeof fetch
) {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') headers['Idempotency-Key'] = crypto.randomUUID();
  if (body) headers['Content-Type'] = 'application/json';
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
 * Changes the name and the phone of the account; the e-mail never changes.
 *
 * @param input - The full name and the 10-digit phone.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The name now kept, or why it was refused.
 */
export function updateProfile(
  input: z.input<typeof profileUpdateRequestSchema>,
  fetchImpl: typeof fetch = fetch
) {
  return request(
    '/v1/account/profile',
    profileUpdatedSchema,
    'PATCH',
    input,
    fetchImpl
  );
}

/**
 * The book of delivery addresses, oldest first.
 *
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The addresses and the most the account may hold, or why not.
 */
export function listAddresses(fetchImpl: typeof fetch = fetch) {
  return request(
    '/v1/account/addresses',
    addressListSchema,
    'GET',
    undefined,
    fetchImpl
  );
}

/**
 * Adds a delivery address (up to five); the first one becomes the default.
 *
 * @param input - The whole address, and whether to make it the default.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns What was saved, or why it was refused.
 */
export function createAddress(
  input: z.input<typeof addressUpsertRequestSchema>,
  fetchImpl: typeof fetch = fetch
) {
  return request(
    '/v1/account/addresses',
    addressSavedSchema,
    'POST',
    input,
    fetchImpl
  );
}

/**
 * Edits or completes an address, or makes it the default one.
 *
 * @param id - The address.
 * @param change - A whole address, or just `{ isDefault: true }`.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns What was saved, or why it was refused.
 */
export function updateAddress(
  id: string,
  change: z.input<typeof addressPatchRequestSchema>,
  fetchImpl: typeof fetch = fetch
) {
  return request(
    `/v1/account/addresses/${id}`,
    addressSavedSchema,
    'PATCH',
    change,
    fetchImpl
  );
}

/**
 * Deletes an address; if it was the default, the newest one left takes its place.
 *
 * @param id - The address.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns Nothing (the API answers 204), or why it was refused.
 */
export function deleteAddress(id: string, fetchImpl: typeof fetch = fetch) {
  return request(
    `/v1/account/addresses/${id}`,
    z.undefined(),
    'DELETE',
    undefined,
    fetchImpl
  );
}
