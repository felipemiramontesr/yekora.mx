/**
 * Typed client of the YĒKORA catalog API (FC 008 F3, ADR 0006), used at build time only.
 *
 * The site is a static export, so it reads the catalog while building (scripts/buildCatalog.ts)
 * and never from the browser. Every answer is validated with Zod before it reaches a page: an
 * API that drifts from its contract fails the build instead of publishing a broken catalog.
 * Native `fetch`, no client library (FC 008). Errors are thrown on purpose: a failed build keeps
 * the previous deploy online, which is safer than shipping an empty or partial catalog.
 *
 * @module
 */
import { z } from 'zod';
import type { Locale } from '@/app/i18n';

/** Largest page the API serves (apps/api/src/routes/catalog.ts). */
const PAGE_SIZE = 48;
/** Per-request budget; the API answers from MariaDB in milliseconds. */
const TIMEOUT_MS = 10_000;

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/** Banxico FIX the API used for the USD reference. */
export const exchangeRateSchema = z.object({
  series: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rate: z.string().regex(/^\d+\.\d{4}$/),
});

/** A product as the listing returns it, in one language. */
const itemSchema = z.object({
  sku: z.string().min(1),
  slug,
  name: z.string().min(1),
  description: z.string(),
  discipline: slug,
  disciplineName: z.string().min(1),
  level: slug,
  levelName: z.string().min(1),
  priceMxnCents: z.number().int().positive(),
  priceUsdCents: z.number().int().nonnegative().nullable(),
  inStock: z.boolean(),
});

/** A product with its gallery, as the detail route returns it. */
export const productSchema = itemSchema.extend({
  images: z.array(
    z.object({
      path: z.string().startsWith('/images/products/'),
      alt: z.string(),
    })
  ),
});

const pageSchema = z.object({
  items: z.array(itemSchema),
  total: z.number().int().nonnegative(),
  exchangeRate: exchangeRateSchema.nullable(),
});

/** Banxico FIX the API used for the USD reference. */
export type ExchangeRate = z.infer<typeof exchangeRateSchema>;
/** A product with its gallery, in one language. */
export type Product = z.infer<typeof productSchema>;

/** The whole active catalog in one language. */
export interface LocaleCatalog {
  /** FIX of the USD reference, or null when the API has none. */
  exchangeRate: ExchangeRate | null;
  /** Every active product with its images, in the API's order (by name). */
  products: Product[];
}

/**
 * Whether a catalog API origin is acceptable for a build: HTTPS anywhere, plain HTTP only on
 * this machine (the local API during development). Prices must not travel unencrypted.
 *
 * @param base - Value of `CATALOG_API_URL`.
 */
export function isAllowedApiBase(base: string): boolean {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return true;
  return (
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  );
}

async function getJson<T>(
  base: string,
  path: string,
  schema: z.ZodType<T>,
  fetchImpl: typeof fetch
): Promise<T> {
  const answer = await fetchImpl(new URL(path, base), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!answer.ok) {
    throw new Error(`Catalog API answered ${answer.status} for ${path}`);
  }
  return schema.parse(await answer.json());
}

/**
 * Reads the whole active catalog of one language: every listing page, then each product's
 * detail for its gallery.
 *
 * @param base - API origin, e.g. `https://apiv1.yekora.mx`.
 * @param locale - Language of names, descriptions and image alt texts.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The products and the FIX the API reported.
 * @throws On a non-2xx answer, a timeout or a payload outside the contract.
 */
export async function fetchCatalog(
  base: string,
  locale: Locale,
  fetchImpl: typeof fetch = fetch
): Promise<LocaleCatalog> {
  const items: z.infer<typeof itemSchema>[] = [];
  let exchangeRate: ExchangeRate | null = null;
  for (let page = 1; ; page++) {
    const answer = await getJson(
      base,
      `/v1/catalog?lang=${locale}&page=${page}&pageSize=${PAGE_SIZE}`,
      pageSchema,
      fetchImpl
    );
    items.push(...answer.items);
    exchangeRate = answer.exchangeRate;
    // An empty page also ends the loop, so a total that drifts mid-read cannot spin forever.
    if (items.length >= answer.total || answer.items.length === 0) break;
  }
  const products = await Promise.all(
    items.map((item) =>
      getJson(
        base,
        `/v1/catalog/${item.slug}?lang=${locale}`,
        productSchema,
        fetchImpl
      )
    )
  );
  return { exchangeRate, products };
}
