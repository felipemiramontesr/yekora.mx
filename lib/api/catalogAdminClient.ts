/**
 * Catalog console client (FC 029 F3): what `/cuenta/catalogo` asks `/v1/admin/catalog/*`.
 *
 * Every request carries credentials (the session cookie), and every write a fresh
 * `Idempotency-Key`, so a double click or a retried request never applies twice (ADR 0014).
 * Answers are checked against the same schemas the API uses (lib/catalog/adminTypes.ts). Like
 * the other clients it never throws: offline, a timeout, an answer outside the contract or a
 * refusal become a typed reason, the refusal by its machine code (the problem's `detail`).
 *
 * @module
 */
import { z } from 'zod';
import {
  type brandCreate,
  type brandPatch,
  brandSchema,
  publishRequestedSchema,
} from '@/lib/catalog/adminTypes';
import { API_URL, call, json, type TransportFailure } from './http';

/** Hostinger may wake the API from sleep; the first request pays its start-up. */
const TIMEOUT_MS = 25_000;

/** Refusals of the catalog the console explains by name. */
const CODES = [
  'CAT_VALIDATION_ERROR',
  'CAT_CONFLICT',
  'CAT_NOT_FOUND',
  'CAT_FORBIDDEN',
  'CAT_SYSTEM_GROUP_LOCKED',
  'CAT_PUBLISH_UNAVAILABLE',
  'CAT_PUBLISH_FAILED',
  'SESSION_INVALID_OR_EXPIRED',
] as const;

/** Why a request gave no usable answer. */
export type CatalogFailure =
  (typeof CODES)[number] | 'rate_limited' | 'unknown' | TransportFailure;

/** An answer of the API, or why there is none. */
type CatalogResult<T> =
  { ok: true; data: T } | { ok: false; reason: CatalogFailure };

/** The refusal of an answer, by its machine code or its status. */
function refusal(status: number, body: unknown): CatalogFailure {
  if (status === 429) return 'rate_limited';
  const detail = (body as { detail?: unknown } | undefined)?.detail;
  return CODES.find((code) => code === detail) ?? 'unknown';
}

/** One request with the session cookie; a write carries a new Idempotency-Key. */
async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  method: 'GET' | 'POST' | 'PATCH',
  body: object | undefined,
  fetchImpl: typeof fetch
): Promise<CatalogResult<T>> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') headers['Idempotency-Key'] = crypto.randomUUID();
  if (body) headers['Content-Type'] = 'application/json';
  const answer = await call(
    fetchImpl,
    `${API_URL}${path}`,
    {
      method,
      credentials: 'include',
      headers,
      body: body && JSON.stringify(body),
    },
    TIMEOUT_MS
  );
  if (typeof answer === 'string') return { ok: false, reason: answer };
  const payload = await json(answer);
  if (!answer.ok) return { ok: false, reason: refusal(answer.status, payload) };
  const parsed = schema.safeParse(payload);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, reason: 'invalid' };
}

/** A brand as the console shows it. */
export type Brand = z.infer<typeof brandSchema>;

/**
 * Every brand, active or retired.
 *
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The brands, or why there are none.
 */
export function listBrands(fetchImpl: typeof fetch = fetch) {
  return request(
    '/v1/admin/catalog/brands',
    z.array(brandSchema),
    'GET',
    undefined,
    fetchImpl
  );
}

/**
 * Creates a brand.
 *
 * @param input - Slug, name and optional https website.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The new brand, or why it was refused.
 */
export function createBrand(
  input: z.input<typeof brandCreate>,
  fetchImpl: typeof fetch = fetch
) {
  return request(
    '/v1/admin/catalog/brands',
    brandSchema,
    'POST',
    input,
    fetchImpl
  );
}

/**
 * Edits, retires (`isActive: false`) or reactivates a brand.
 *
 * @param id - The brand.
 * @param patch - The fields to change.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The brand after the change, or why it was refused.
 */
export function updateBrand(
  id: number,
  patch: z.input<typeof brandPatch>,
  fetchImpl: typeof fetch = fetch
) {
  return request(
    `/v1/admin/catalog/brands/${id}`,
    brandSchema,
    'PATCH',
    patch,
    fetchImpl
  );
}

/**
 * Asks the API to rebuild the store with the current catalog (T2.5).
 *
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns When the publication was requested, or why it was refused.
 */
export function publishCatalog(fetchImpl: typeof fetch = fetch) {
  return request(
    '/v1/admin/catalog/publish',
    publishRequestedSchema,
    'POST',
    undefined,
    fetchImpl
  );
}
