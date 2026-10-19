/**
 * Catalog queries (FC 008): active products with their discipline, level and images.
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
  /** Experience level slug, or null for all levels. */
  level: string | null;
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
 * A product row with both languages and its references. Discipline and level names come from
 * their reference tables (ADR 0007), so a new level shows up on the site without a frontend
 * change.
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
  discipline: string;
  discipline_name_es: string;
  discipline_name_en: string;
  level: string;
  level_name_es: string;
  level_name_en: string;
}

/** An image row of a product. */
interface ImageRow {
  path: string;
  alt_es: string;
  alt_en: string;
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
  const filters = [
    query.discipline,
    query.discipline,
    query.level,
    query.level,
  ];
  const [{ total }] = await db.query<{ total: number }>(
    'SELECT COUNT(*) AS total FROM products p JOIN categories c ON c.id = p.category_id JOIN experience_levels l ON l.id = p.experience_level_id WHERE p.is_active = 1 AND c.is_active = 1 AND l.is_active = 1 AND (? IS NULL OR c.slug = ?) AND (? IS NULL OR l.slug = ?)',
    filters
  );
  const items = await db.query<ProductRow>(
    "SELECT p.sku, p.slug, p.name_es, p.name_en, p.description_es, p.description_en, p.price_mxn_cents, p.stock, c.slug AS discipline, c.name_es AS discipline_name_es, c.name_en AS discipline_name_en, l.slug AS level, l.name_es AS level_name_es, l.name_en AS level_name_en FROM products p JOIN categories c ON c.id = p.category_id JOIN experience_levels l ON l.id = p.experience_level_id WHERE p.is_active = 1 AND c.is_active = 1 AND l.is_active = 1 AND (? IS NULL OR c.slug = ?) AND (? IS NULL OR l.slug = ?) ORDER BY CASE WHEN ? = 'price_asc' THEN p.price_mxn_cents END ASC, CASE WHEN ? = 'price_desc' THEN p.price_mxn_cents END DESC, CASE WHEN ? = 'en' THEN p.name_en ELSE p.name_es END ASC, p.id ASC LIMIT ? OFFSET ?",
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

/**
 * One active product by slug, with its images in display order.
 *
 * @param db - Database port.
 * @param slug - Product slug (already validated by the route).
 * @returns The product and its images, or null when it does not exist or is inactive.
 */
export async function findProduct(
  db: Db,
  slug: string
): Promise<{ product: ProductRow; images: ImageRow[] } | null> {
  const [product] = await db.query<ProductRow>(
    'SELECT p.sku, p.slug, p.name_es, p.name_en, p.description_es, p.description_en, p.price_mxn_cents, p.stock, c.slug AS discipline, c.name_es AS discipline_name_es, c.name_en AS discipline_name_en, l.slug AS level, l.name_es AS level_name_es, l.name_en AS level_name_en FROM products p JOIN categories c ON c.id = p.category_id JOIN experience_levels l ON l.id = p.experience_level_id WHERE p.slug = ? AND p.is_active = 1 AND c.is_active = 1 AND l.is_active = 1',
    [slug]
  );
  if (!product) return null;
  const images = await db.query<ImageRow>(
    'SELECT i.path, i.alt_es, i.alt_en FROM product_images i JOIN products p ON p.id = i.product_id WHERE p.slug = ? ORDER BY i.sort_order ASC',
    [slug]
  );
  return { product, images };
}
