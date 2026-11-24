/**
 * Catalog queries (FC 008): active products with their discipline, brand, properties and images.
 *
 * Every statement is static SQL with `?` placeholders (T1.1). Optional filters use the
 * `(? IS NULL OR col = ?)` pattern, and sorting uses CASE expressions over a bound sort key, so
 * no SQL text is ever assembled from input. Both languages are selected and the API picks one,
 * instead of interpolating a column name. Retired references (`is_active = 0`, ADR 0007) and
 * inactive products never show.
 *
 * @module
 */
import type { Db } from './db';

/** Sort keys accepted by the catalog (tied to the API contract, so a closed set). */
export const SORTS = ['name', 'price_asc', 'price_desc'] as const;
/** One of {@link SORTS}. */
type Sort = (typeof SORTS)[number];

/** Filters and paging of a catalog listing. */
interface CatalogQuery {
  /** Category slug, or null for all disciplines. */
  discipline: string | null;
  /** Ordering. */
  sort: Sort;
  /** `en` sorts by English names; anything else by Spanish. */
  lang: 'es-MX' | 'en';
  /** 1-based page. */
  page: number;
  /** Items per page. */
  pageSize: number;
}

/**
 * A product row with both languages and its references. The discipline name comes from its
 * reference table (ADR 0007), so a new discipline shows up on the site without a frontend change.
 */
export interface ProductRow {
  sku: string;
  slug: string;
  name_es: string;
  name_en: string;
  description_es: string;
  description_en: string;
  price_mxn_cents: number;
  stock: number;
  /** 1 when the product may be returned after it is delivered (FC 071), 0 when not. */
  allows_return: number;
  discipline: string;
  discipline_name_es: string;
  discipline_name_en: string;
  /** Slug and name of its brand: null without one, or when the brand is retired (FC 047). */
  brand: string | null;
  brand_name: string | null;
}

/**
 * One page of active products and the total matching the filters.
 *
 * @param db - Database port.
 * @param query - Filters, sort and paging (already validated by the route).
 * @returns The page of products and the total count.
 */
export async function listProducts(
  db: Db,
  query: CatalogQuery
): Promise<{ items: ProductRow[]; total: number }> {
  const filters = [query.discipline, query.discipline];
  const [{ total }] = await db.query<{ total: number }>(
    'SELECT COUNT(*) AS total FROM products p JOIN categories c ON c.id = p.category_id WHERE p.is_active = 1 AND c.is_active = 1 AND (? IS NULL OR c.slug = ?)',
    filters
  );
  const items = await db.query<ProductRow>(
    "SELECT p.sku, p.slug, p.name_es, p.name_en, p.description_es, p.description_en, p.price_mxn_cents, p.stock, p.allows_return, c.slug AS discipline, c.name_es AS discipline_name_es, c.name_en AS discipline_name_en, b.slug AS brand, b.name AS brand_name FROM products p JOIN categories c ON c.id = p.category_id LEFT JOIN brands b ON b.id = p.brand_id AND b.is_active = 1 WHERE p.is_active = 1 AND c.is_active = 1 AND (? IS NULL OR c.slug = ?) ORDER BY CASE WHEN ? = 'price_asc' THEN p.price_mxn_cents END ASC, CASE WHEN ? = 'price_desc' THEN p.price_mxn_cents END DESC, CASE WHEN ? = 'en' THEN p.name_en ELSE p.name_es END ASC, p.id ASC LIMIT ? OFFSET ?",
    [
      ...filters,
      query.sort,
      query.sort,
      query.lang,
      query.pageSize,
      (query.page - 1) * query.pageSize,
    ]
  );
  return { items, total: Number(total) };
}

/** One image of a product's gallery: the digest it is served under and its alt texts. */
interface MediaRow {
  sha256: string;
  alt_text_es: string | null;
  alt_text_en: string | null;
}

/**
 * The active gallery of a product (FC 029 F1): primary image first, then by sort order.
 *
 * Images live in `product_media` and are served by digest from `GET /v1/media/:sha256`; the
 * retired `product_images` (migration 006, T0.2) is never read.
 *
 * @param db - Database port.
 * @param slug - Product slug (already validated by the route).
 * @returns The images, possibly none.
 */
export function findProductMedia(db: Db, slug: string): Promise<MediaRow[]> {
  return db.query<MediaRow>(
    'SELECT m.media_sha256 AS sha256, m.alt_text_es, m.alt_text_en FROM product_media m JOIN products p ON p.id = m.product_id WHERE p.slug = ? AND m.is_active = 1 ORDER BY m.is_primary DESC, m.sort_order ASC, m.id ASC',
    [slug]
  );
}

/** One property of a product: a value of an active group, with both languages. */
export interface PropertyRow {
  group_code: string;
  group_name_es: string;
  group_name_en: string;
  is_filterable: number;
  value_code: string;
  value_es: string;
  value_en: string;
}

/**
 * The properties of a product (FC 048 T0.2): the values of its active groups, in the order the
 * store set (group order, then value order). A retired group does not show.
 *
 * @param db - Database port.
 * @param slug - Product slug (already validated by the route).
 * @returns The properties, possibly none.
 */
export function findProductProperties(
  db: Db,
  slug: string
): Promise<PropertyRow[]> {
  return db.query<PropertyRow>(
    'SELECT g.code AS group_code, g.name_es AS group_name_es, g.name_en AS group_name_en, g.is_filterable, v.code AS value_code, v.value_es, v.value_en FROM products p JOIN product_facet_links k ON k.product_id = p.id JOIN product_facet_values v ON v.id = k.value_id JOIN product_facet_groups g ON g.id = v.group_id WHERE p.slug = ? AND g.is_active = 1 ORDER BY g.sort_order ASC, g.id ASC, v.sort_order ASC, v.id ASC',
    [slug]
  );
}

/**
 * One active product by slug; its gallery comes from {@link findProductMedia}.
 *
 * @param db - Database port.
 * @param slug - Product slug (already validated by the route).
 * @returns The product, or null when it does not exist or is inactive.
 */
export async function findProduct(
  db: Db,
  slug: string
): Promise<ProductRow | null> {
  const [product] = await db.query<ProductRow>(
    'SELECT p.sku, p.slug, p.name_es, p.name_en, p.description_es, p.description_en, p.price_mxn_cents, p.stock, p.allows_return, c.slug AS discipline, c.name_es AS discipline_name_es, c.name_en AS discipline_name_en, b.slug AS brand, b.name AS brand_name FROM products p JOIN categories c ON c.id = p.category_id LEFT JOIN brands b ON b.id = p.brand_id AND b.is_active = 1 WHERE p.slug = ? AND p.is_active = 1 AND c.is_active = 1',
    [slug]
  );
  return product ?? null;
}
