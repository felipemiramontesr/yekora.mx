/**
 * Products of the catalog backoffice (FC 029 F2b2): the console lists and reads every product,
 * and creates, edits, retires and arranges the gallery of one, through
 * routes/catalogMutation.ts (Idempotency-Key, payload, once per key, audit in the same
 * transaction). The rules of the data live in services/catalogProducts.ts.
 *
 * @module
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { problem, PROBLEM_TYPE } from '../lib/problem';
import {
  createProduct,
  listAdminProducts,
  readAdminProduct,
  replaceGallery,
  updateProduct,
} from '../services/catalogProducts';
import { SHA256_HEX } from '../services/media';
import {
  type CatalogAdminDeps,
  idParams,
  mutationRoute,
} from './catalogMutation';

const slug = (max: number) =>
  z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(max);
const text = (max: number) => z.string().trim().min(1).max(max);
const positive = z.number().int().positive().max(100_000_000);
const quantity = z.number().int().min(0).max(1_000_000);
const facetIds = z.array(z.number().int().positive()).max(50);

/** The editable fields of a product, all required on create. */
const fields = {
  nameEs: text(200),
  nameEn: text(200),
  descriptionEs: z.string().max(10_000),
  descriptionEn: z.string().max(10_000),
  priceMxnCents: positive,
  stock: quantity,
  discipline: slug(40),
  level: slug(40),
  brandId: z.number().int().positive().nullable(),
  shippingClass: slug(40),
  weightGrams: positive,
  lengthMm: positive,
  widthMm: positive,
  heightMm: positive,
};

/** Body of `POST /v1/admin/catalog/products`; SKU and slug are fixed from then on. */
export const productCreate = z.strictObject({
  sku: z
    .string()
    .regex(/^[A-Z0-9][A-Z0-9-]{0,63}$/)
    .max(64),
  slug: slug(160),
  ...fields,
  brandId: fields.brandId.default(null),
  facetValueIds: facetIds.default([]),
});

/** Body of `PATCH /v1/admin/catalog/products/:id`: any field, `isActive`, the facet list. */
export const productPatch = z.strictObject({
  ...Object.fromEntries(
    Object.entries(fields).map(([key, schema]) => [key, schema.optional()])
  ),
  isActive: z.boolean().optional(),
  facetValueIds: facetIds.optional(),
}) as z.ZodType<
  Partial<{ [K in keyof typeof fields]: z.infer<(typeof fields)[K]> }> & {
    isActive?: boolean;
    facetValueIds?: number[];
  }
>;

const altText = z.string().trim().max(255).nullable().default(null);

/** Body of `PATCH /v1/admin/catalog/products/:id/media`: the gallery, in order, first primary. */
export const galleryPatch = z.strictObject({
  images: z
    .array(
      z.strictObject({
        sha256: z.string().regex(SHA256_HEX),
        altEs: altText,
        altEn: altText,
      })
    )
    .max(12)
    .refine(
      (images) =>
        new Set(images.map((image) => image.sha256)).size === images.length,
      'An image appears twice'
    ),
});

/** Paging of the product list. */
export const productListQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

/** A product as the backoffice answers it. */
export const adminProductSchema = z.object({
  id: z.number().int().positive(),
  sku: z.string(),
  slug: z.string(),
  nameEs: z.string(),
  nameEn: z.string(),
  descriptionEs: z.string(),
  descriptionEn: z.string(),
  priceMxnCents: z.number().int().positive(),
  stock: z.number().int().nonnegative(),
  reservedStock: z.number().int().nonnegative(),
  discipline: z.string(),
  level: z.string(),
  brandId: z.number().int().positive().nullable(),
  shippingClass: z.string(),
  weightGrams: z.number().int().positive(),
  lengthMm: z.number().int().positive(),
  widthMm: z.number().int().positive(),
  heightMm: z.number().int().positive(),
  isActive: z.boolean(),
  isTest: z.boolean(),
  facetValueIds: z.array(z.number().int().positive()),
  gallery: z.array(
    z.object({
      sha256: z.string().regex(SHA256_HEX),
      altEs: z.string().nullable(),
      altEn: z.string().nullable(),
      sortOrder: z.number().int(),
      isPrimary: z.boolean(),
    })
  ),
});

/** One page of the product list. */
export const adminProductPageSchema = z.object({
  items: z.array(adminProductSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});

/**
 * Registers the product routes.
 *
 * @param app - Fastify instance.
 * @param deps - Database and clock.
 */
export function registerCatalogProductRoutes(
  app: FastifyInstance,
  deps: CatalogAdminDeps
): void {
  app.get('/v1/admin/catalog/products', async (request, reply) => {
    const query = productListQuery.safeParse(request.query);
    if (!query.success) {
      return reply
        .code(400)
        .type(PROBLEM_TYPE)
        .send(problem(400, 'Invalid catalog data', 'CAT_VALIDATION_ERROR'));
    }
    return { ...(await listAdminProducts(deps.db, query.data)), ...query.data };
  });

  app.get('/v1/admin/catalog/products/:id', async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const product = params.success
      ? await readAdminProduct(deps.db, params.data.id)
      : null;
    if (product === null) {
      const status = params.success ? 404 : 400;
      return reply
        .code(status)
        .type(PROBLEM_TYPE)
        .send(
          problem(
            status,
            params.success ? 'Not found' : 'Invalid catalog data',
            params.success ? 'CAT_NOT_FOUND' : 'CAT_VALIDATION_ERROR'
          )
        );
    }
    return product;
  });

  mutationRoute(app, deps, {
    method: 'POST',
    url: '/v1/admin/catalog/products',
    entityType: 'products',
    body: productCreate,
    run: (tx, { body }) => createProduct(tx, body),
  });
  mutationRoute(app, deps, {
    method: 'PATCH',
    url: '/v1/admin/catalog/products/:id',
    entityType: 'products',
    params: idParams,
    body: productPatch,
    run: (tx, { params, body }) => updateProduct(tx, params.id, body),
  });
  mutationRoute(app, deps, {
    method: 'PATCH',
    url: '/v1/admin/catalog/products/:id/media',
    entityType: 'products',
    params: idParams,
    body: galleryPatch,
    run: (tx, { params, body }) => replaceGallery(tx, params.id, body.images),
  });
}
