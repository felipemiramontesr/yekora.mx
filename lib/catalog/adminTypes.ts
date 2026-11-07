/**
 * The catalog backoffice contract (FC 029 F2 and F3): what `/v1/admin/catalog/*` accepts and
 * answers, shared by the API (which parses requests with these schemas and documents them in
 * apps/api/src/contract.ts) and the console of `/cuenta/catalogo` (which checks every answer
 * against them). One definition, so the two can never drift.
 *
 * @module
 */
import { z } from 'zod';

/** A SHA-256 digest as `media_blobs` stores it: 64 lowercase hex characters. */
export const SHA256_HEX = /^[0-9a-f]{64}$/;

/** The image types the store accepts (CHECK `ck_media_blobs_mime` of migration 006). */
export const SAFE_IMAGE_TYPES = [
  'image/webp',
  'image/jpeg',
  'image/png',
] as const;

/** One of {@link SAFE_IMAGE_TYPES}. */
export type SafeImageType = (typeof SAFE_IMAGE_TYPES)[number];

/* ---------- images ---------- */

/** Answer of an accepted upload: the digest the image is served under and what was probed. */
export const mediaUploadedSchema = z.object({
  code: z.literal('MEDIA_ACCEPTED'),
  created: z.boolean(),
  sha256: z.string().regex(SHA256_HEX),
  mimeType: z.enum(SAFE_IMAGE_TYPES),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sizeBytes: z.number().int().positive(),
});

/* ---------- brands and facets ---------- */

const brandSlug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(100);
const code = z
  .string()
  .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/)
  .max(50);
const label = (max: number) => z.string().trim().min(1).max(max);
const website = z
  .url({ protocol: /^https$/ })
  .max(255)
  .nullable();
const order = z.number().int().min(-1000).max(1000);

/* ---------- request schemas (also the contract's) ---------- */

/** Body of `POST /v1/admin/catalog/brands`. */
export const brandCreate = z.strictObject({
  slug: brandSlug,
  name: label(150),
  website: website.default(null),
});

/** Body of `PATCH /v1/admin/catalog/brands/:id`: the slug is fixed once published. */
export const brandPatch = z.strictObject({
  name: label(150).optional(),
  website: website.optional(),
  isActive: z.boolean().optional(),
});

const groupFields = {
  nameEs: label(100),
  nameEn: label(100),
  isRequired: z.boolean(),
  isOrdered: z.boolean(),
  isFilterable: z.boolean(),
  showOnLanding: z.boolean(),
  sortOrder: order,
};

/** Body of `POST /v1/admin/catalog/facet-groups`. */
export const facetGroupCreate = z.strictObject({
  code,
  nameEs: groupFields.nameEs,
  nameEn: groupFields.nameEn,
  isRequired: groupFields.isRequired.default(false),
  isOrdered: groupFields.isOrdered.default(false),
  isFilterable: groupFields.isFilterable.default(true),
  showOnLanding: groupFields.showOnLanding.default(false),
  sortOrder: groupFields.sortOrder.default(0),
});

/** Body of `PATCH /v1/admin/catalog/facet-groups/:id`: the code is fixed. */
export const facetGroupPatch = z.strictObject({
  nameEs: groupFields.nameEs.optional(),
  nameEn: groupFields.nameEn.optional(),
  isRequired: groupFields.isRequired.optional(),
  isOrdered: groupFields.isOrdered.optional(),
  isFilterable: groupFields.isFilterable.optional(),
  showOnLanding: groupFields.showOnLanding.optional(),
  isActive: z.boolean().optional(),
  sortOrder: groupFields.sortOrder.optional(),
});

/** Body of `POST /v1/admin/catalog/facet-groups/:id/values`. */
export const facetValueCreate = z.strictObject({
  code,
  valueEs: label(100),
  valueEn: label(100),
  sortOrder: order.default(0),
});

/** Body of `PATCH /v1/admin/catalog/facet-values/:id`: the code is fixed. */
export const facetValuePatch = z.strictObject({
  valueEs: label(100).optional(),
  valueEn: label(100).optional(),
  sortOrder: order.optional(),
});

/* ---------- answer schemas (the contract's) ---------- */

/** A brand as the backoffice answers it. */
export const brandSchema = z.object({
  id: z.number().int().positive(),
  slug: z.string(),
  name: z.string(),
  website: z.string().nullable(),
  isActive: z.boolean(),
});

/** A facet value as the backoffice answers it. */
export const facetValueSchema = z.object({
  id: z.number().int().positive(),
  code: z.string(),
  valueEs: z.string(),
  valueEn: z.string(),
  sortOrder: z.number().int(),
});

/** A facet group with its values. */
export const facetGroupSchema = z.object({
  id: z.number().int().positive(),
  code: z.string(),
  nameEs: z.string(),
  nameEn: z.string(),
  isRequired: z.boolean(),
  isOrdered: z.boolean(),
  isFilterable: z.boolean(),
  showOnLanding: z.boolean(),
  isSystem: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  values: z.array(facetValueSchema),
});

/* ---------- products ---------- */

const productSlug = (max: number) =>
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
  discipline: productSlug(40),
  level: productSlug(40),
  brandId: z.number().int().positive().nullable(),
  shippingClass: productSlug(40),
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
  slug: productSlug(160),
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

/* ---------- publishing ---------- */

/** Answer of an accepted publication: what GitHub was asked to run, and when. */
export const publishRequestedSchema = z.object({
  code: z.literal('CAT_PUBLISH_REQUESTED'),
  workflow: z.literal('deploy.yml'),
  ref: z.literal('main'),
  requestedAt: z.iso.datetime(),
});
