/**
 * Catalog routes (FC 008): `GET /v1/catalog` and `GET /v1/catalog/:slug`.
 *
 * Input is validated with Zod before any query (slugs, sort keys, language, paging). Output
 * carries one language, the price in MXN cents, the USD reference derived from the current FIX
 * (null when there is none) and the FIX it used, so the site can say which rate it shows.
 * An empty catalog is a normal answer (production starts empty until K-07).
 *
 * @module
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { usdCents } from '../lib/money';
import { problem, PROBLEM_TYPE } from '../lib/problem';
import {
  findProduct,
  listProducts,
  SORTS,
  type ProductRow,
} from '../services/catalog';
import type { Db } from '../services/db';
import type { CurrentRate } from '../services/exchangeRate';

const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(160);
const lang = z.enum(['es-MX', 'en']).default('es-MX');

const listQuery = z.object({
  discipline: slug.max(40).optional(),
  level: slug.max(40).optional(),
  sort: z.enum(SORTS).default('name'),
  lang,
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(48).default(24),
});

/** Dependencies of the catalog routes. */
interface CatalogDeps {
  /** Database port. */
  db: Db;
  /** Current FIX (cached), or null when none is stored. */
  rate: () => Promise<CurrentRate | null>;
}

/** Product as the API returns it, in one language. */
function present(
  row: ProductRow,
  language: 'es-MX' | 'en',
  fix: number | null
) {
  const english = language === 'en';
  return {
    sku: row.sku,
    slug: row.slug,
    name: english ? row.name_en : row.name_es,
    description: english ? row.description_en : row.description_es,
    discipline: row.discipline,
    disciplineName: english ? row.discipline_name_en : row.discipline_name_es,
    level: row.level,
    levelName: english ? row.level_name_en : row.level_name_es,
    priceMxnCents: Number(row.price_mxn_cents),
    priceUsdCents: usdCents(Number(row.price_mxn_cents), fix),
    inStock: Number(row.stock) > 0,
  };
}

/**
 * Registers the catalog routes.
 *
 * @param app - Fastify instance.
 * @param deps - Database and FIX provider.
 */
export function registerCatalogRoutes(
  app: FastifyInstance,
  deps: CatalogDeps
): void {
  app.get('/v1/catalog', async (request, reply) => {
    const parsed = listQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .type(PROBLEM_TYPE)
        .send(problem(400, 'Invalid query', parsed.error.issues[0]?.message));
    }
    const query = parsed.data;
    const [{ items, total }, rate] = await Promise.all([
      listProducts(deps.db, {
        ...query,
        discipline: query.discipline ?? null,
        level: query.level ?? null,
      }),
      deps.rate(),
    ]);
    const fix = rate ? Number(rate.rate) : null;
    return {
      items: items.map((row) => present(row, query.lang, fix)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      exchangeRate: rate,
    };
  });

  app.get('/v1/catalog/:slug', async (request, reply) => {
    const params = z.object({ slug }).safeParse(request.params);
    const language = lang.safeParse((request.query as { lang?: unknown }).lang);
    if (!params.success || !language.success) {
      return reply
        .code(400)
        .type(PROBLEM_TYPE)
        .send(problem(400, 'Invalid request'));
    }
    const [found, rate] = await Promise.all([
      findProduct(deps.db, params.data.slug),
      deps.rate(),
    ]);
    if (!found) {
      return reply
        .code(404)
        .type(PROBLEM_TYPE)
        .send(problem(404, 'Product not found'));
    }
    const english = language.data === 'en';
    return {
      ...present(found.product, language.data, rate ? Number(rate.rate) : null),
      images: found.images.map((image) => ({
        path: image.path,
        alt: english ? image.alt_en : image.alt_es,
      })),
      exchangeRate: rate,
    };
  });
}
