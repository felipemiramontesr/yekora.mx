/**
 * Products of the catalog backoffice (FC 029 F2b2): list, read, create, edit, retire, their
 * facets and their gallery, inside the transaction of the request's Idempotency-Key.
 *
 * - Nothing is deleted: a product is retired with `is_active = 0` and an image leaves a gallery
 *   with `is_active = 0` (T2.3c). The SKU and the slug never change once created: orders and
 *   published URLs name them.
 * - Discipline, level, shipping class and brand must exist and be active
 *   (CAT_REFERENCE_INVALID); the stock never drops below what pending orders reserved
 *   (CAT_STOCK_BELOW_RESERVED, the CHECK of migration 003).
 * - T2.6: `products.experience_level_id` and the product's value of the system group Nivel move
 *   together. A new level relinks Nivel; a Nivel value among the facets sets the level; both
 *   given and different is CAT_VALIDATION_ERROR.
 *
 * Every statement is static SQL with `?` placeholders (A03); lists of ids are walked one
 * statement at a time instead of building an `IN (…)`.
 *
 * @module
 */
import type { CatalogRefusal, Change } from './catalogAdmin';
import type { Db, TxQuery } from './db';

/** Why a product write was refused, besides the generic catalog refusals. */
export type ProductRefusal =
  | CatalogRefusal
  | 'CAT_VALIDATION_ERROR'
  | 'CAT_REFERENCE_INVALID'
  | 'CAT_STOCK_BELOW_RESERVED';

/** One image of a gallery. */
interface GalleryImage {
  sha256: string;
  altEs: string | null;
  altEn: string | null;
  sortOrder: number;
  isPrimary: boolean;
}

/** A product as the backoffice shows it. */
interface AdminProduct {
  id: number;
  sku: string;
  slug: string;
  nameEs: string;
  nameEn: string;
  descriptionEs: string;
  descriptionEn: string;
  priceMxnCents: number;
  stock: number;
  reservedStock: number;
  discipline: string;
  level: string;
  brandId: number | null;
  shippingClass: string;
  weightGrams: number;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  isActive: boolean;
  isTest: boolean;
  /** Values of the ordinary facet groups (Nivel is `level`). */
  facetValueIds: number[];
  gallery: GalleryImage[];
}

/** The editable fields of a product, by reference slug or id. */
interface ProductFields {
  nameEs: string;
  nameEn: string;
  descriptionEs: string;
  descriptionEn: string;
  priceMxnCents: number;
  stock: number;
  discipline: string;
  level: string;
  brandId: number | null;
  shippingClass: string;
  weightGrams: number;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
}

/** What creating a product takes. */
type ProductCreate = ProductFields & {
  sku: string;
  slug: string;
  facetValueIds: number[];
};

/** What editing a product may change. */
type ProductPatch = Partial<ProductFields> & {
  isActive?: boolean;
  facetValueIds?: number[];
};

interface ProductRow {
  id: number;
  sku: string;
  slug: string;
  name_es: string;
  name_en: string;
  description_es: string;
  description_en: string;
  price_mxn_cents: number;
  stock: number;
  reserved_stock: number;
  discipline: string;
  level: string;
  brand_id: number | null;
  shipping_class: string;
  weight_grams: number;
  length_mm: number;
  width_mm: number;
  height_mm: number;
  is_active: number;
  is_test: number;
}

const num = (value: unknown) => Number(value);

const productOf = (
  row: ProductRow,
  facetValueIds: number[] = [],
  gallery: GalleryImage[] = []
): AdminProduct => ({
  id: num(row.id),
  sku: row.sku,
  slug: row.slug,
  nameEs: row.name_es,
  nameEn: row.name_en,
  descriptionEs: row.description_es,
  descriptionEn: row.description_en,
  priceMxnCents: num(row.price_mxn_cents),
  stock: num(row.stock),
  reservedStock: num(row.reserved_stock),
  discipline: row.discipline,
  level: row.level,
  brandId: row.brand_id === null ? null : num(row.brand_id),
  shippingClass: row.shipping_class,
  weightGrams: num(row.weight_grams),
  lengthMm: num(row.length_mm),
  widthMm: num(row.width_mm),
  heightMm: num(row.height_mm),
  isActive: num(row.is_active) === 1,
  isTest: num(row.is_test) === 1,
  facetValueIds,
  gallery,
});

/**
 * One page of products, active or not, by Spanish name; facets and gallery come with the detail.
 *
 * @param db - Database port.
 * @param paging - 1-based page and its size.
 * @returns The page and the total.
 */
export async function listAdminProducts(
  db: Db,
  paging: { page: number; pageSize: number }
): Promise<{ items: AdminProduct[]; total: number }> {
  const [{ total }] = await db.query<{ total: number }>(
    'SELECT COUNT(*) AS total FROM products'
  );
  const rows = await db.query<ProductRow>(
    'SELECT p.id, p.sku, p.slug, p.name_es, p.name_en, p.description_es, p.description_en, p.price_mxn_cents, p.stock, p.reserved_stock, c.slug AS discipline, l.slug AS level, p.brand_id, s.slug AS shipping_class, p.weight_grams, p.length_mm, p.width_mm, p.height_mm, p.is_active, p.is_test FROM products p JOIN categories c ON c.id = p.category_id JOIN experience_levels l ON l.id = p.experience_level_id JOIN shipping_classes s ON s.id = p.shipping_class_id ORDER BY p.name_es ASC, p.id ASC LIMIT ? OFFSET ?',
    [paging.pageSize, (paging.page - 1) * paging.pageSize]
  );
  return { items: rows.map((row) => productOf(row)), total: num(total) };
}

/** The product row, with its references by slug. */
async function productRow(
  tx: TxQuery,
  id: number
): Promise<ProductRow | undefined> {
  const [row] = await tx.query<ProductRow>(
    'SELECT p.id, p.sku, p.slug, p.name_es, p.name_en, p.description_es, p.description_en, p.price_mxn_cents, p.stock, p.reserved_stock, c.slug AS discipline, l.slug AS level, p.brand_id, s.slug AS shipping_class, p.weight_grams, p.length_mm, p.width_mm, p.height_mm, p.is_active, p.is_test FROM products p JOIN categories c ON c.id = p.category_id JOIN experience_levels l ON l.id = p.experience_level_id JOIN shipping_classes s ON s.id = p.shipping_class_id WHERE p.id = ?',
    [id]
  );
  return row;
}

/** Locks the product for the rest of the transaction, then reads it. */
async function lockedProduct(
  tx: TxQuery,
  id: number
): Promise<ProductRow | undefined> {
  const [found] = await tx.query<{ id: number }>(
    'SELECT id FROM products WHERE id = ? FOR UPDATE',
    [id]
  );
  return found ? productRow(tx, id) : undefined;
}

/** The product with its ordinary facet values and its active gallery. */
async function fullProduct(
  tx: TxQuery,
  row: ProductRow
): Promise<AdminProduct> {
  const values = await tx.query<{ value_id: number }>(
    'SELECT k.value_id FROM product_facet_links k JOIN product_facet_values v ON v.id = k.value_id JOIN product_facet_groups g ON g.id = v.group_id WHERE k.product_id = ? AND g.is_system = 0 ORDER BY k.value_id ASC',
    [row.id]
  );
  const images = await tx.query<{
    media_sha256: string;
    alt_text_es: string | null;
    alt_text_en: string | null;
    sort_order: number;
    is_primary: number;
  }>(
    'SELECT media_sha256, alt_text_es, alt_text_en, sort_order, is_primary FROM product_media WHERE product_id = ? AND is_active = 1 ORDER BY is_primary DESC, sort_order ASC, id ASC',
    [row.id]
  );
  return productOf(
    row,
    values.map((value) => num(value.value_id)),
    images.map((image) => ({
      sha256: image.media_sha256,
      altEs: image.alt_text_es,
      altEn: image.alt_text_en,
      sortOrder: num(image.sort_order),
      isPrimary: num(image.is_primary) === 1,
    }))
  );
}

/**
 * One product, active or not, with its facets and gallery.
 *
 * @param db - Database port.
 * @param id - The product.
 * @returns The product, or null.
 */
export async function readAdminProduct(
  db: Db,
  id: number
): Promise<AdminProduct | null> {
  const row = await productRow(db, id);
  return row ? fullProduct(db, row) : null;
}

/** Ids of the active references a product points to, or null when one is missing or retired. */
async function references(
  tx: TxQuery,
  fields: Pick<
    ProductFields,
    'discipline' | 'level' | 'shippingClass' | 'brandId'
  >
): Promise<{ category: number; level: number; shipping: number } | null> {
  const [category] = await tx.query<{ id: number }>(
    'SELECT id FROM categories WHERE slug = ? AND is_active = 1',
    [fields.discipline]
  );
  const [level] = await tx.query<{ id: number }>(
    'SELECT id FROM experience_levels WHERE slug = ? AND is_active = 1',
    [fields.level]
  );
  const [shipping] = await tx.query<{ id: number }>(
    'SELECT id FROM shipping_classes WHERE slug = ? AND is_active = 1',
    [fields.shippingClass]
  );
  const brandOk =
    fields.brandId === null ||
    (
      await tx.query<{ id: number }>(
        'SELECT id FROM brands WHERE id = ? AND is_active = 1',
        [fields.brandId]
      )
    ).length === 1;
  if (!category || !level || !shipping || !brandOk) return null;
  return { category: category.id, level: level.id, shipping: shipping.id };
}

/** The facet values asked for, split into ordinary ones and the Nivel code they may carry. */
async function facetChoice(
  tx: TxQuery,
  ids: readonly number[]
): Promise<
  { ordinary: number[]; level: string | null } | 'CAT_REFERENCE_INVALID'
> {
  const ordinary: number[] = [];
  let level: string | null = null;
  for (const id of new Set(ids)) {
    const [value] = await tx.query<{
      code: string;
      is_system: number;
      is_active: number;
    }>(
      'SELECT v.code, g.is_system, g.is_active FROM product_facet_values v JOIN product_facet_groups g ON g.id = v.group_id WHERE v.id = ?',
      [id]
    );
    if (!value || num(value.is_active) !== 1) return 'CAT_REFERENCE_INVALID';
    if (num(value.is_system) === 1) level = value.code;
    else ordinary.push(id);
  }
  return { ordinary, level };
}

/** T2.6: the product's Nivel value is exactly the one of its level. */
async function relinkLevel(
  tx: TxQuery,
  productId: number,
  level: string
): Promise<void> {
  await tx.query(
    "DELETE k FROM product_facet_links k JOIN product_facet_values v ON v.id = k.value_id JOIN product_facet_groups g ON g.id = v.group_id WHERE k.product_id = ? AND g.is_system = 1 AND g.code = 'nivel'",
    [productId]
  );
  await tx.query(
    "INSERT INTO product_facet_links (product_id, value_id) SELECT ?, v.id FROM product_facet_values v JOIN product_facet_groups g ON g.id = v.group_id WHERE g.is_system = 1 AND g.code = 'nivel' AND v.code = ?",
    [productId, level]
  );
}

/** The product's ordinary facet values are exactly `ids`. */
async function relinkFacets(
  tx: TxQuery,
  productId: number,
  ids: readonly number[]
): Promise<void> {
  await tx.query(
    'DELETE k FROM product_facet_links k JOIN product_facet_values v ON v.id = k.value_id JOIN product_facet_groups g ON g.id = v.group_id WHERE k.product_id = ? AND g.is_system = 0',
    [productId]
  );
  for (const id of ids) {
    await tx.query(
      'INSERT INTO product_facet_links (product_id, value_id) VALUES (?, ?)',
      [productId, id]
    );
  }
}

/**
 * The level a write ends with (T2.6): the one given, else the Nivel value among the facets,
 * else the current one; null when the two given disagree.
 */
function settledLevel(
  given: string | undefined,
  fromFacets: string | null,
  current: string
): string | null {
  if (given !== undefined && fromFacets !== null && given !== fromFacets)
    return null;
  return given ?? fromFacets ?? current;
}

/**
 * Creates a product (active), links its level's Nivel value and its facets.
 *
 * @param tx - The transaction of the request.
 * @param input - Every field, the SKU, the slug and the facet values.
 * @returns The new product, or the refusal.
 * @throws The driver's ER_DUP_ENTRY when the SKU or the slug is taken.
 */
export async function createProduct(
  tx: TxQuery,
  input: ProductCreate
): Promise<Change<AdminProduct> | ProductRefusal> {
  const facets = await facetChoice(tx, input.facetValueIds);
  if (facets === 'CAT_REFERENCE_INVALID') return facets;
  const level = settledLevel(input.level, facets.level, input.level);
  if (level === null) return 'CAT_VALIDATION_ERROR';
  const refs = await references(tx, input);
  if (refs === null) return 'CAT_REFERENCE_INVALID';
  await tx.query(
    'INSERT INTO products (sku, slug, category_id, brand_id, experience_level_id, name_es, name_en, description_es, description_en, price_mxn_cents, stock, weight_grams, length_mm, width_mm, height_mm, shipping_class_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      input.sku,
      input.slug,
      refs.category,
      input.brandId,
      refs.level,
      input.nameEs,
      input.nameEn,
      input.descriptionEs,
      input.descriptionEn,
      input.priceMxnCents,
      input.stock,
      input.weightGrams,
      input.lengthMm,
      input.widthMm,
      input.heightMm,
      refs.shipping,
    ]
  );
  const [{ id }] = await tx.query<{ id: number }>(
    'SELECT id FROM products WHERE sku = ?',
    [input.sku]
  );
  await relinkLevel(tx, id, level);
  await relinkFacets(tx, id, facets.ordinary);
  const row = (await productRow(tx, id)) as ProductRow;
  return { before: null, after: await fullProduct(tx, row) };
}

/**
 * Edits or retires a product; the SKU and the slug stay. A new level relinks Nivel (T2.6); a
 * facet list replaces the product's ordinary values.
 *
 * @param tx - The transaction of the request.
 * @param id - The product.
 * @param patch - The fields to change.
 * @returns The change, or the refusal.
 */
export async function updateProduct(
  tx: TxQuery,
  id: number,
  patch: ProductPatch
): Promise<Change<AdminProduct> | ProductRefusal> {
  const row = await lockedProduct(tx, id);
  if (!row) return 'CAT_NOT_FOUND';
  const before = await fullProduct(tx, row);
  const facets = await facetChoice(tx, patch.facetValueIds ?? []);
  if (facets === 'CAT_REFERENCE_INVALID') return facets;
  const level = settledLevel(patch.level, facets.level, before.level);
  if (level === null) return 'CAT_VALIDATION_ERROR';
  const { facetValueIds, isActive, ...fields } = patch;
  const next = {
    ...before,
    ...fields,
    level,
    isActive: isActive ?? before.isActive,
  };
  if (next.stock < before.reservedStock) return 'CAT_STOCK_BELOW_RESERVED';
  const refs = await references(tx, next);
  if (refs === null) return 'CAT_REFERENCE_INVALID';
  await tx.query(
    'UPDATE products SET category_id = ?, brand_id = ?, experience_level_id = ?, name_es = ?, name_en = ?, description_es = ?, description_en = ?, price_mxn_cents = ?, stock = ?, weight_grams = ?, length_mm = ?, width_mm = ?, height_mm = ?, shipping_class_id = ?, is_active = ? WHERE id = ?',
    [
      refs.category,
      next.brandId,
      refs.level,
      next.nameEs,
      next.nameEn,
      next.descriptionEs,
      next.descriptionEn,
      next.priceMxnCents,
      next.stock,
      next.weightGrams,
      next.lengthMm,
      next.widthMm,
      next.heightMm,
      refs.shipping,
      next.isActive ? 1 : 0,
      id,
    ]
  );
  if (level !== before.level) await relinkLevel(tx, id, level);
  if (facetValueIds !== undefined) await relinkFacets(tx, id, facets.ordinary);
  const after = await fullProduct(tx, (await productRow(tx, id)) as ProductRow);
  return { before, after };
}

/**
 * Replaces a product's gallery, in order; the first image is the primary one. An image that
 * leaves is retired (`is_active = 0`), never deleted, and comes back with its row if re-added.
 *
 * @param tx - The transaction of the request.
 * @param id - The product.
 * @param images - The digests (already uploaded) and their alt texts, in order.
 * @returns The change of the product (its gallery), or the refusal.
 */
export async function replaceGallery(
  tx: TxQuery,
  id: number,
  images: readonly {
    sha256: string;
    altEs: string | null;
    altEn: string | null;
  }[]
): Promise<Change<AdminProduct> | ProductRefusal> {
  const row = await lockedProduct(tx, id);
  if (!row) return 'CAT_NOT_FOUND';
  for (const image of images) {
    const [blob] = await tx.query<{ sha256: string }>(
      'SELECT sha256 FROM media_blobs WHERE sha256 = ?',
      [image.sha256]
    );
    if (!blob) return 'CAT_REFERENCE_INVALID';
  }
  const before = await fullProduct(tx, row);
  await tx.query(
    'UPDATE product_media SET is_active = 0, is_primary = 0 WHERE product_id = ?',
    [id]
  );
  for (const [index, image] of images.entries()) {
    const values = [image.altEs, image.altEn, index, index === 0 ? 1 : 0];
    const [existing] = await tx.query<{ id: number }>(
      'SELECT id FROM product_media WHERE product_id = ? AND media_sha256 = ? ORDER BY id ASC LIMIT 1',
      [id, image.sha256]
    );
    if (existing) {
      await tx.query(
        'UPDATE product_media SET alt_text_es = ?, alt_text_en = ?, sort_order = ?, is_primary = ?, is_active = 1 WHERE id = ?',
        [...values, existing.id]
      );
    } else {
      await tx.query(
        'INSERT INTO product_media (alt_text_es, alt_text_en, sort_order, is_primary, product_id, media_sha256) VALUES (?, ?, ?, ?, ?, ?)',
        [...values, id, image.sha256]
      );
    }
  }
  return { before, after: await fullProduct(tx, row) };
}
