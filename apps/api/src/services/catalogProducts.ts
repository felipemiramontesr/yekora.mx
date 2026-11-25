/**
 * Products of the catalog backoffice (FC 029 F2b2): list, read, create, edit, retire, their
 * facets and their gallery, inside the transaction of the request's Idempotency-Key.
 *
 * - Nothing is deleted: a product is retired with `is_active = 0` and an image leaves a gallery
 *   with `is_active = 0` (T2.3c). The SKU and the slug never change once created: orders and
 *   published URLs name them.
 * - Discipline, shipping class and brand must exist and be active (CAT_REFERENCE_INVALID); the
 *   stock never drops below what pending orders reserved (CAT_STOCK_BELOW_RESERVED, the CHECK of
 *   migration 003).
 * - A product's properties are the values of the groups it is linked to; each must belong to an
 *   active group (CAT_REFERENCE_INVALID). There is no level (FC 048): it is not a field, nor a
 *   group of its own.
 * - A product is born with its gallery (FC 049): 1 to 5 photos, already uploaded, in the same
 *   transaction as the product; one that is not in `media_blobs` refuses the whole creation.
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

/** One image to place in a gallery: an uploaded digest and its alt texts. */
interface GalleryInput {
  sha256: string;
  altEs: string | null;
  altEn: string | null;
}

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
  brandId: number | null;
  shippingClass: string;
  weightGrams: number;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  allowsReturn: boolean;
  isActive: boolean;
  isTest: boolean;
  /** Values of the product's properties. */
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
  brandId: number | null;
  shippingClass: string;
  weightGrams: number;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  allowsReturn: boolean;
}

/** What creating a product takes. */
type ProductCreate = ProductFields & {
  sku: string;
  slug: string;
  facetValueIds: number[];
  images: readonly GalleryInput[];
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
  brand_id: number | null;
  shipping_class: string;
  weight_grams: number;
  length_mm: number;
  width_mm: number;
  height_mm: number;
  allows_return: number;
  is_active: number;
  is_test: number;
}

const productOf = (
  row: ProductRow,
  facetValueIds: number[] = [],
  gallery: GalleryImage[] = []
): AdminProduct => ({
  id: Number(row.id),
  sku: row.sku,
  slug: row.slug,
  nameEs: row.name_es,
  nameEn: row.name_en,
  descriptionEs: row.description_es,
  descriptionEn: row.description_en,
  priceMxnCents: Number(row.price_mxn_cents),
  stock: Number(row.stock),
  reservedStock: Number(row.reserved_stock),
  discipline: row.discipline,
  brandId: row.brand_id === null ? null : Number(row.brand_id),
  shippingClass: row.shipping_class,
  weightGrams: Number(row.weight_grams),
  lengthMm: Number(row.length_mm),
  widthMm: Number(row.width_mm),
  heightMm: Number(row.height_mm),
  allowsReturn: Number(row.allows_return) === 1,
  isActive: Number(row.is_active) === 1,
  isTest: Number(row.is_test) === 1,
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
    'SELECT p.id, p.sku, p.slug, p.name_es, p.name_en, p.description_es, p.description_en, p.price_mxn_cents, p.stock, p.reserved_stock, c.slug AS discipline, p.brand_id, s.slug AS shipping_class, p.weight_grams, p.length_mm, p.width_mm, p.height_mm, p.allows_return, p.is_active, p.is_test FROM products p JOIN categories c ON c.id = p.category_id JOIN shipping_classes s ON s.id = p.shipping_class_id ORDER BY p.name_es ASC, p.id ASC LIMIT ? OFFSET ?',
    [paging.pageSize, (paging.page - 1) * paging.pageSize]
  );
  // Each product comes with its properties and its stored gallery, so «Edit» and «Gallery»
  // open on what it has (FC 049 T2.2); older products need no migration to have them.
  const items = await Promise.all(rows.map((row) => fullProduct(db, row)));
  return { items, total: Number(total) };
}

/** The product row, with its references by slug. */
async function productRow(
  tx: TxQuery,
  id: number
): Promise<ProductRow | undefined> {
  const [row] = await tx.query<ProductRow>(
    'SELECT p.id, p.sku, p.slug, p.name_es, p.name_en, p.description_es, p.description_en, p.price_mxn_cents, p.stock, p.reserved_stock, c.slug AS discipline, p.brand_id, s.slug AS shipping_class, p.weight_grams, p.length_mm, p.width_mm, p.height_mm, p.allows_return, p.is_active, p.is_test FROM products p JOIN categories c ON c.id = p.category_id JOIN shipping_classes s ON s.id = p.shipping_class_id WHERE p.id = ?',
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

/** The product with its property values and its active gallery. */
async function fullProduct(
  tx: TxQuery,
  row: ProductRow
): Promise<AdminProduct> {
  const values = await tx.query<{ value_id: number }>(
    'SELECT value_id FROM product_facet_links WHERE product_id = ? ORDER BY value_id ASC',
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
    values.map((value) => Number(value.value_id)),
    images.map((image) => ({
      sha256: image.media_sha256,
      altEs: image.alt_text_es,
      altEn: image.alt_text_en,
      sortOrder: Number(image.sort_order),
      isPrimary: Number(image.is_primary) === 1,
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
  fields: Pick<ProductFields, 'discipline' | 'shippingClass' | 'brandId'>
): Promise<{ category: number; shipping: number } | null> {
  const [category] = await tx.query<{ id: number }>(
    'SELECT id FROM categories WHERE slug = ? AND is_active = 1',
    [fields.discipline]
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
  if (!category || !shipping || !brandOk) return null;
  return { category: category.id, shipping: shipping.id };
}

/** The property values asked for, once each; every one must belong to an active group. */
async function checkedFacets(
  tx: TxQuery,
  ids: readonly number[]
): Promise<number[] | 'CAT_REFERENCE_INVALID'> {
  const unique = [...new Set(ids)];
  const found = await Promise.all(
    unique.map(async (id) => {
      const [value] = await tx.query<{ is_active: number }>(
        'SELECT g.is_active FROM product_facet_values v JOIN product_facet_groups g ON g.id = v.group_id WHERE v.id = ?',
        [id]
      );
      return value;
    })
  );
  if (found.some((value) => !value || Number(value.is_active) !== 1))
    return 'CAT_REFERENCE_INVALID';
  return unique;
}

/** The product's property values are exactly `ids`. */
async function relinkFacets(
  tx: TxQuery,
  productId: number,
  ids: readonly number[]
): Promise<void> {
  await tx.query('DELETE FROM product_facet_links WHERE product_id = ?', [
    productId,
  ]);
  // One connection runs these in order; Promise.all only stops waiting between them.
  await Promise.all(
    ids.map((id) =>
      tx.query(
        'INSERT INTO product_facet_links (product_id, value_id) VALUES (?, ?)',
        [productId, id]
      )
    )
  );
}

/**
 * Creates a product (active) with its property values and its gallery of 1 to 5 photos, the
 * first one primary, all or nothing.
 *
 * @param tx - The transaction of the request.
 * @param input - Every field, the SKU, the slug, the property values and the photos.
 * @returns The new product, or the refusal.
 * @throws The driver's ER_DUP_ENTRY when the SKU or the slug is taken.
 */
export async function createProduct(
  tx: TxQuery,
  input: ProductCreate
): Promise<Change<AdminProduct> | ProductRefusal> {
  const facets = await checkedFacets(tx, input.facetValueIds);
  if (facets === 'CAT_REFERENCE_INVALID') return facets;
  const refs = await references(tx, input);
  if (refs === null || !(await checkedBlobs(tx, input.images)))
    return 'CAT_REFERENCE_INVALID';
  await tx.query(
    'INSERT INTO products (sku, slug, category_id, brand_id, name_es, name_en, description_es, description_en, price_mxn_cents, stock, weight_grams, length_mm, width_mm, height_mm, shipping_class_id, allows_return) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      input.sku,
      input.slug,
      refs.category,
      input.brandId,
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
      input.allowsReturn ? 1 : 0,
    ]
  );
  const [{ id }] = await tx.query<{ id: number }>(
    'SELECT id FROM products WHERE sku = ?',
    [input.sku]
  );
  await relinkFacets(tx, id, facets);
  await Promise.all(
    input.images.map((image, index) => placeImage(tx, id, image, index))
  );
  const row = (await productRow(tx, id)) as ProductRow;
  return { before: null, after: await fullProduct(tx, row) };
}

/**
 * Edits or retires a product; the SKU and the slug stay. A list of property values replaces the
 * product's own.
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
  const facets = await checkedFacets(tx, patch.facetValueIds ?? []);
  if (facets === 'CAT_REFERENCE_INVALID') return facets;
  const { facetValueIds, isActive, ...fields } = patch;
  const next = {
    ...before,
    ...fields,
    isActive: isActive ?? before.isActive,
  };
  if (next.stock < before.reservedStock) return 'CAT_STOCK_BELOW_RESERVED';
  const refs = await references(tx, next);
  if (refs === null) return 'CAT_REFERENCE_INVALID';
  await tx.query(
    'UPDATE products SET category_id = ?, brand_id = ?, name_es = ?, name_en = ?, description_es = ?, description_en = ?, price_mxn_cents = ?, stock = ?, weight_grams = ?, length_mm = ?, width_mm = ?, height_mm = ?, shipping_class_id = ?, allows_return = ?, is_active = ? WHERE id = ?',
    [
      refs.category,
      next.brandId,
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
      next.allowsReturn ? 1 : 0,
      next.isActive ? 1 : 0,
      id,
    ]
  );
  if (facetValueIds !== undefined) await relinkFacets(tx, id, facets);
  const after = await fullProduct(tx, (await productRow(tx, id)) as ProductRow);
  return { before, after };
}

/** Whether every image of a gallery was uploaded (its digest is in `media_blobs`). */
async function checkedBlobs(
  tx: TxQuery,
  images: readonly GalleryInput[]
): Promise<boolean> {
  const blobs = await Promise.all(
    images.map((image) =>
      tx.query<{ sha256: string }>(
        'SELECT sha256 FROM media_blobs WHERE sha256 = ?',
        [image.sha256]
      )
    )
  );
  return blobs.every((rows) => rows.length > 0);
}

/**
 * Puts one image at its place in a product's gallery: its retired row comes back when the
 * product had it before, else a new row (rows are never deleted, T2.3c).
 */
async function placeImage(
  tx: TxQuery,
  productId: number,
  image: GalleryInput,
  index: number
): Promise<void> {
  const values = [image.altEs, image.altEn, index, index === 0 ? 1 : 0];
  const [existing] = await tx.query<{ id: number }>(
    'SELECT id FROM product_media WHERE product_id = ? AND media_sha256 = ? ORDER BY id ASC LIMIT 1',
    [productId, image.sha256]
  );
  if (existing) {
    await tx.query(
      'UPDATE product_media SET alt_text_es = ?, alt_text_en = ?, sort_order = ?, is_primary = ?, is_active = 1 WHERE id = ?',
      [...values, existing.id]
    );
  } else {
    await tx.query(
      'INSERT INTO product_media (alt_text_es, alt_text_en, sort_order, is_primary, product_id, media_sha256) VALUES (?, ?, ?, ?, ?, ?)',
      [...values, productId, image.sha256]
    );
  }
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
  images: readonly GalleryInput[]
): Promise<Change<AdminProduct> | ProductRefusal> {
  const row = await lockedProduct(tx, id);
  if (!row) return 'CAT_NOT_FOUND';
  if (!(await checkedBlobs(tx, images))) return 'CAT_REFERENCE_INVALID';
  const before = await fullProduct(tx, row);
  await tx.query(
    'UPDATE product_media SET is_active = 0, is_primary = 0 WHERE product_id = ?',
    [id]
  );
  await Promise.all(
    images.map((image, index) => placeImage(tx, id, image, index))
  );
  return { before, after: await fullProduct(tx, row) };
}
