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
import { languageSchema } from '../lib/language';
import { usdCents } from '../lib/money';
import { problem, PROBLEM_TYPE } from '../lib/problem';
import {
  findProduct,
  findProductMedia,
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

/** Query of `GET /v1/catalog`; also the request of the API contract (contract.ts). */
export const catalogListQuery = z.object({
  discipline: slug.max(40).optional(),
  level: slug.max(40).optional(),
  sort: z.enum(SORTS).default('name'),
  lang: languageSchema,
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(48).default(24),
});

/** Path parameters of `GET /v1/catalog/:slug`. */
export const catalogItemParams = z.object({ slug });

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
    const parsed = catalogListQuery.safeParse(request.query);
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
    const params = catalogItemParams.safeParse(request.params);
    const language = languageSchema.safeParse(
      (request.query as { lang?: unknown }).lang
    );
    if (!params.success || !language.success) {
      return reply
        .code(400)
        .type(PROBLEM_TYPE)
        .send(problem(400, 'Invalid request'));
    }
    const [found, media, rate] = await Promise.all([
      findProduct(deps.db, params.data.slug),
      findProductMedia(deps.db, params.data.slug),
      deps.rate(),
    ]);
    if (!found) {
      return reply
        .code(404)
        .type(PROBLEM_TYPE)
        .send(problem(404, 'Product not found'));
    }
    const product = present(
      found,
      language.data,
      rate ? Number(rate.rate) : null
    );
    const english = language.data === 'en';
    return {
      ...product,
      // FC 029 F1: each image by its digest; the site prefixes the API origin. An image without
      // an alt text in this language is named after the product, never left unlabeled.
      images: media.map((image) => ({
        path: `/v1/media/${image.sha256}`,
        alt: (english ? image.alt_text_en : image.alt_text_es) ?? product.name,
      })),
      exchangeRate: rate,
    };
  });
}
