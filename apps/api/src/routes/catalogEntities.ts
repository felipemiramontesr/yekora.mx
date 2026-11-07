/**
 * Brands and facets of the catalog backoffice (FC 029 F2b). Reads list everything, active or
 * not, for the console; writes go through routes/catalogMutation.ts (Idempotency-Key, payload,
 * once per key, audit in the same transaction). Retiring is `isActive: false` (T2.3c); the
 * system group Nivel is never retired and its values are not edited by hand (T2.1b, T2.6).
 *
 * @module
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createBrand,
  createFacetGroup,
  createFacetValue,
  listBrands,
  listFacets,
  updateBrand,
  updateFacetGroup,
  updateFacetValue,
} from '../services/catalogAdmin';
import {
  type CatalogAdminDeps,
  idParams,
  mutationRoute,
} from './catalogMutation';

const slug = z
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
  slug,
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

/**
 * Registers the brand and facet routes.
 *
 * @param app - Fastify instance.
 * @param deps - Database and clock.
 */
export function registerCatalogEntityRoutes(
  app: FastifyInstance,
  deps: CatalogAdminDeps
): void {
  app.get('/v1/admin/catalog/brands', async () => listBrands(deps.db));
  app.get('/v1/admin/catalog/facets', async () => listFacets(deps.db));

  mutationRoute(app, deps, {
    method: 'POST',
    url: '/v1/admin/catalog/brands',
    entityType: 'brands',
    body: brandCreate,
    run: (tx, { body }) => createBrand(tx, body),
  });
  mutationRoute(app, deps, {
    method: 'PATCH',
    url: '/v1/admin/catalog/brands/:id',
    entityType: 'brands',
    params: idParams,
    body: brandPatch,
    run: (tx, { params, body }) => updateBrand(tx, params.id, body),
  });
  mutationRoute(app, deps, {
    method: 'POST',
    url: '/v1/admin/catalog/facet-groups',
    entityType: 'facet_groups',
    body: facetGroupCreate,
    run: (tx, { body }) => createFacetGroup(tx, body),
  });
  mutationRoute(app, deps, {
    method: 'PATCH',
    url: '/v1/admin/catalog/facet-groups/:id',
    entityType: 'facet_groups',
    params: idParams,
    body: facetGroupPatch,
    run: (tx, { params, body }) => updateFacetGroup(tx, params.id, body),
  });
  mutationRoute(app, deps, {
    method: 'POST',
    url: '/v1/admin/catalog/facet-groups/:id/values',
    entityType: 'facet_values',
    params: idParams,
    body: facetValueCreate,
    run: (tx, { params, body }) => createFacetValue(tx, params.id, body),
  });
  mutationRoute(app, deps, {
    method: 'PATCH',
    url: '/v1/admin/catalog/facet-values/:id',
    entityType: 'facet_values',
    params: idParams,
    body: facetValuePatch,
    run: (tx, { params, body }) => updateFacetValue(tx, params.id, body),
  });
}
