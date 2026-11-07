/**
 * Products of the catalog backoffice (FC 029 F2b2): the console lists and reads every product,
 * and creates, edits, retires and arranges the gallery of one, through
 * routes/catalogMutation.ts (Idempotency-Key, payload, once per key, audit in the same
 * transaction). The rules of the data live in services/catalogProducts.ts.
 *
 * @module
 */
import type { FastifyInstance } from 'fastify';
import {
  galleryPatch,
  productCreate,
  productListQuery,
  productPatch,
} from '../../../../lib/catalog/adminTypes';
import { problem, PROBLEM_TYPE } from '../lib/problem';
import {
  createProduct,
  listAdminProducts,
  readAdminProduct,
  replaceGallery,
  updateProduct,
} from '../services/catalogProducts';
import {
  type CatalogAdminDeps,
  idParams,
  mutationRoute,
} from './catalogMutation';

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
