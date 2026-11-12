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
  adminProductPageSchema,
  adminProductSchema,
  type brandCreate,
  type brandPatch,
  brandSchema,
  type facetGroupCreate,
  type facetGroupPatch,
  facetGroupSchema,
  type facetValueCreate,
  type facetValuePatch,
  facetValueSchema,
  type galleryPatch,
  mediaUploadedSchema,
  type productCreate,
  type productPatch,
  publishRequestedSchema,
} from '@/lib/catalog/adminTypes';
import { sessionRequest, type TransportFailure } from './http';

/** Hostinger may wake the API from sleep; the first request pays its start-up. */
const TIMEOUT_MS = 25_000;

/** Refusals of the catalog the console explains by name. */
const CODES = [
  'CAT_VALIDATION_ERROR',
  'CAT_CONFLICT',
  'CAT_NOT_FOUND',
  'CAT_FORBIDDEN',
  'CAT_SYSTEM_GROUP_LOCKED',
  'CAT_REFERENCE_INVALID',
  'CAT_STOCK_BELOW_RESERVED',
  'MEDIA_UNSAFE_TYPE',
  'MEDIA_SIZE_EXCEEDED',
  'MEDIA_DIMENSIONS_INVALID',
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
function request<T>(
  path: string,
  schema: z.ZodType<T>,
  method: 'GET' | 'POST' | 'PATCH',
  body: object | undefined,
  fetchImpl: typeof fetch
): Promise<CatalogResult<T>> {
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

/** A brand as the console shows it. */
export type Brand = z.infer<typeof brandSchema>;

/** A facet group with its values, as the console shows it. */
export type FacetGroup = z.infer<typeof facetGroupSchema>;

/** A product as the console shows it. */
export type AdminProduct = z.infer<typeof adminProductSchema>;

/** One page of the product list. */
export type ProductPage = z.infer<typeof adminProductPageSchema>;

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
 * Every facet group with its values, active or retired.
 *
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The groups, or why there are none.
 */
export function listFacets(fetchImpl: typeof fetch = fetch) {
  return request(
    '/v1/admin/catalog/facets',
    z.array(facetGroupSchema),
    'GET',
    undefined,
    fetchImpl
  );
}

/**
 * Creates a facet group (never a system one).
 *
 * @param input - Code, names in both languages, flags and order.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The new group, or why it was refused.
 */
export function createFacetGroup(
  input: z.input<typeof facetGroupCreate>,
  fetchImpl: typeof fetch = fetch
) {
  return request(
    '/v1/admin/catalog/facet-groups',
    facetGroupSchema,
    'POST',
    input,
    fetchImpl
  );
}

/**
 * Edits, retires (`isActive: false`) or reactivates a facet group; the system group Nivel is
 * never retired.
 *
 * @param id - The group.
 * @param patch - The fields to change.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The group after the change, or why it was refused.
 */
export function updateFacetGroup(
  id: number,
  patch: z.input<typeof facetGroupPatch>,
  fetchImpl: typeof fetch = fetch
) {
  return request(
    `/v1/admin/catalog/facet-groups/${id}`,
    facetGroupSchema,
    'PATCH',
    patch,
    fetchImpl
  );
}

/**
 * Adds a value to a facet group (not to the system group).
 *
 * @param groupId - The group.
 * @param input - Code, labels in both languages and order.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The new value, or why it was refused.
 */
export function createFacetValue(
  groupId: number,
  input: z.input<typeof facetValueCreate>,
  fetchImpl: typeof fetch = fetch
) {
  return request(
    `/v1/admin/catalog/facet-groups/${groupId}/values`,
    facetValueSchema,
    'POST',
    input,
    fetchImpl
  );
}

/**
 * Relabels or reorders a facet value (not of the system group).
 *
 * @param id - The value.
 * @param patch - The fields to change.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The value after the change, or why it was refused.
 */
export function updateFacetValue(
  id: number,
  patch: z.input<typeof facetValuePatch>,
  fetchImpl: typeof fetch = fetch
) {
  return request(
    `/v1/admin/catalog/facet-values/${id}`,
    facetValueSchema,
    'PATCH',
    patch,
    fetchImpl
  );
}

/**
 * One page of products, active or retired.
 *
 * @param page - Page number, from 1.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The page, or why there is none.
 */
export function listProducts(page = 1, fetchImpl: typeof fetch = fetch) {
  return request(
    `/v1/admin/catalog/products?page=${page}`,
    adminProductPageSchema,
    'GET',
    undefined,
    fetchImpl
  );
}

/**
 * Creates a product; its SKU and slug are fixed from then on.
 *
 * @param input - SKU, slug and every editable field.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The new product, or why it was refused.
 */
export function createProduct(
  input: z.input<typeof productCreate>,
  fetchImpl: typeof fetch = fetch
) {
  return request(
    '/v1/admin/catalog/products',
    adminProductSchema,
    'POST',
    input,
    fetchImpl
  );
}

/**
 * Edits, retires (`isActive: false`) or reactivates a product.
 *
 * @param id - The product.
 * @param patch - The fields to change.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The product after the change, or why it was refused.
 */
export function updateProduct(
  id: number,
  patch: z.infer<typeof productPatch>,
  fetchImpl: typeof fetch = fetch
) {
  return request(
    `/v1/admin/catalog/products/${id}`,
    adminProductSchema,
    'PATCH',
    patch,
    fetchImpl
  );
}

/**
 * Replaces the gallery of a product, in order; the first image is the primary one.
 *
 * @param id - The product.
 * @param gallery - The digests of already uploaded images and their alt texts.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The product with its new gallery, or why it was refused.
 */
export function replaceGallery(
  id: number,
  gallery: z.input<typeof galleryPatch>,
  fetchImpl: typeof fetch = fetch
) {
  return request(
    `/v1/admin/catalog/products/${id}/media`,
    adminProductSchema,
    'PATCH',
    gallery,
    fetchImpl
  );
}

/**
 * Uploads one cropped image as its raw bytes (T1.2): WebP, JPEG or PNG, at most 2 MB, 1200, 600
 * or 300 px wide. The API stores it once per digest and answers with that digest.
 *
 * @param image - The cropped image, whose type is sent as the Content-Type.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns What the API stored, or why it was refused.
 */
export function uploadMedia(image: Blob, fetchImpl: typeof fetch = fetch) {
  return sessionRequest(
    fetchImpl,
    '/v1/admin/catalog/media',
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': image.type,
        'Idempotency-Key': crypto.randomUUID(),
      },
      raw: image,
    },
    TIMEOUT_MS,
    mediaUploadedSchema,
    refusal
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
