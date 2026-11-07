/**
 * Brands and facets of the catalog backoffice (FC 029 F2b). Reads list everything, active or
 * not, for the console; writes go through routes/catalogMutation.ts (Idempotency-Key, payload,
 * once per key, audit in the same transaction). Retiring is `isActive: false` (T2.3c); the
 * system group Nivel is never retired and its values are not edited by hand (T2.1b, T2.6).
 *
 * @module
 */
import type { FastifyInstance } from 'fastify';
import {
  brandCreate,
  brandPatch,
  facetGroupCreate,
  facetGroupPatch,
  facetValueCreate,
  facetValuePatch,
} from '../../../../lib/catalog/adminTypes';
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
