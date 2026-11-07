/**
 * Catalog backoffice data (FC 029 F2b): brands and facets, read and written by the routes of
 * `/v1/admin/catalog/*` inside the transaction of their Idempotency-Key.
 *
 * Nothing here deletes: a brand or a facet group is retired with `is_active = 0` (T2.3c). The
 * system group Nivel mirrors `experience_levels` (T2.6), so it can never be retired (T2.1b, also
 * a CHECK of migration 006) and its values are not edited by hand. Every write returns the state
 * before and after, which the route records in `audit_log` (T2.4).
 *
 * @module
 */
import type { Db, TxQuery } from './db';

/** A brand as the backoffice shows it. */
interface Brand {
  id: number;
  slug: string;
  name: string;
  website: string | null;
  isActive: boolean;
}

/** A facet value as the backoffice shows it. */
interface FacetValue {
  id: number;
  code: string;
  valueEs: string;
  valueEn: string;
  sortOrder: number;
}

/** A facet group with its values. */
interface FacetGroup {
  id: number;
  code: string;
  nameEs: string;
  nameEn: string;
  isRequired: boolean;
  isOrdered: boolean;
  isFilterable: boolean;
  showOnLanding: boolean;
  isSystem: boolean;
  isActive: boolean;
  sortOrder: number;
  values: FacetValue[];
}

/** The flags and order of a facet group a request may set. */
interface FacetGroupFields {
  nameEs: string;
  nameEn: string;
  isRequired: boolean;
  isOrdered: boolean;
  isFilterable: boolean;
  showOnLanding: boolean;
  isActive: boolean;
  sortOrder: number;
}

/** A change and the state on each side of it, for `audit_log`. */
export interface Change<T> {
  before: T | null;
  after: T;
}

/** Why a write was refused. */
export type CatalogRefusal = 'CAT_NOT_FOUND' | 'CAT_SYSTEM_GROUP_LOCKED';

/* ---------- brands ---------- */

interface BrandRow {
  id: number;
  slug: string;
  name: string;
  website: string | null;
  is_active: number;
}

const brandOf = (row: BrandRow): Brand => ({
  id: Number(row.id),
  slug: row.slug,
  name: row.name,
  website: row.website,
  isActive: Number(row.is_active) === 1,
});

/**
 * Every brand, active or not, by name.
 *
 * @param db - Database port.
 * @returns The brands.
 */
export async function listBrands(db: Db): Promise<Brand[]> {
  const rows = await db.query<BrandRow>(
    'SELECT id, slug, name, website, is_active FROM brands ORDER BY name ASC, id ASC'
  );
  return rows.map(brandOf);
}

async function lockBrand(tx: TxQuery, id: number): Promise<Brand | null> {
  const [row] = await tx.query<BrandRow>(
    'SELECT id, slug, name, website, is_active FROM brands WHERE id = ? FOR UPDATE',
    [id]
  );
  return row ? brandOf(row) : null;
}

/**
 * Creates a brand (active).
 *
 * @param tx - The transaction of the request.
 * @param input - Slug, name and optional website.
 * @returns The new brand, after the insert.
 * @throws The driver's ER_DUP_ENTRY when the slug is taken.
 */
export async function createBrand(
  tx: TxQuery,
  input: { slug: string; name: string; website: string | null }
): Promise<Change<Brand>> {
  await tx.query('INSERT INTO brands (slug, name, website) VALUES (?, ?, ?)', [
    input.slug,
    input.name,
    input.website,
  ]);
  const [row] = await tx.query<BrandRow>(
    'SELECT id, slug, name, website, is_active FROM brands WHERE slug = ?',
    [input.slug]
  );
  return { before: null, after: brandOf(row) };
}

/**
 * Edits or retires a brand; its slug never changes (it may be in published URLs).
 *
 * @param tx - The transaction of the request.
 * @param id - The brand.
 * @param patch - The fields to change.
 * @returns The change, or CAT_NOT_FOUND.
 */
export async function updateBrand(
  tx: TxQuery,
  id: number,
  patch: Partial<Pick<Brand, 'name' | 'website' | 'isActive'>>
): Promise<Change<Brand> | CatalogRefusal> {
  const before = await lockBrand(tx, id);
  if (before === null) return 'CAT_NOT_FOUND';
  const after = { ...before, ...patch };
  await tx.query(
    'UPDATE brands SET name = ?, website = ?, is_active = ? WHERE id = ?',
    [after.name, after.website, after.isActive ? 1 : 0, id]
  );
  return { before, after };
}

/* ---------- facets ---------- */

interface GroupRow {
  id: number;
  code: string;
  name_es: string;
  name_en: string;
  is_required: number;
  is_ordered: number;
  is_filterable: number;
  show_on_landing: number;
  is_system: number;
  is_active: number;
  sort_order: number;
}

interface ValueRow {
  id: number;
  group_id: number;
  code: string;
  value_es: string;
  value_en: string;
  sort_order: number;
}

const flag = (value: number) => Number(value) === 1;

const groupOf = (row: GroupRow, values: FacetValue[] = []): FacetGroup => ({
  id: Number(row.id),
  code: row.code,
  nameEs: row.name_es,
  nameEn: row.name_en,
  isRequired: flag(row.is_required),
  isOrdered: flag(row.is_ordered),
  isFilterable: flag(row.is_filterable),
  showOnLanding: flag(row.show_on_landing),
  isSystem: flag(row.is_system),
  isActive: flag(row.is_active),
  sortOrder: Number(row.sort_order),
  values,
});

const valueOf = (row: ValueRow): FacetValue => ({
  id: Number(row.id),
  code: row.code,
  valueEs: row.value_es,
  valueEn: row.value_en,
  sortOrder: Number(row.sort_order),
});

/**
 * Every facet group, active or not, with its values, both in their sort order.
 *
 * @param db - Database port.
 * @returns The groups.
 */
export async function listFacets(db: Db): Promise<FacetGroup[]> {
  const groups = await db.query<GroupRow>(
    'SELECT id, code, name_es, name_en, is_required, is_ordered, is_filterable, show_on_landing, is_system, is_active, sort_order FROM product_facet_groups ORDER BY sort_order ASC, id ASC'
  );
  const values = await db.query<ValueRow>(
    'SELECT id, group_id, code, value_es, value_en, sort_order FROM product_facet_values ORDER BY sort_order ASC, id ASC'
  );
  return groups.map((group) =>
    groupOf(
      group,
      values
        .filter((value) => Number(value.group_id) === Number(group.id))
        .map(valueOf)
    )
  );
}

async function lockGroup(tx: TxQuery, id: number): Promise<FacetGroup | null> {
  const [row] = await tx.query<GroupRow>(
    'SELECT id, code, name_es, name_en, is_required, is_ordered, is_filterable, show_on_landing, is_system, is_active, sort_order FROM product_facet_groups WHERE id = ? FOR UPDATE',
    [id]
  );
  return row ? groupOf(row) : null;
}

/**
 * Creates a facet group (active, never a system group: Nivel is the only one, seeded by 006).
 *
 * @param tx - The transaction of the request.
 * @param input - Code and the group's names, flags and order.
 * @returns The new group, after the insert.
 * @throws The driver's ER_DUP_ENTRY when the code is taken.
 */
export async function createFacetGroup(
  tx: TxQuery,
  input: { code: string } & Omit<FacetGroupFields, 'isActive'>
): Promise<Change<FacetGroup>> {
  await tx.query(
    'INSERT INTO product_facet_groups (code, name_es, name_en, is_required, is_ordered, is_filterable, show_on_landing, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      input.code,
      input.nameEs,
      input.nameEn,
      input.isRequired ? 1 : 0,
      input.isOrdered ? 1 : 0,
      input.isFilterable ? 1 : 0,
      input.showOnLanding ? 1 : 0,
      input.sortOrder,
    ]
  );
  const [row] = await tx.query<GroupRow>(
    'SELECT id, code, name_es, name_en, is_required, is_ordered, is_filterable, show_on_landing, is_system, is_active, sort_order FROM product_facet_groups WHERE code = ?',
    [input.code]
  );
  return { before: null, after: groupOf(row) };
}

/**
 * Edits or retires a facet group; its code never changes. The system group may be renamed and
 * reordered, never retired (T2.1b).
 *
 * @param tx - The transaction of the request.
 * @param id - The group.
 * @param patch - The fields to change.
 * @returns The change, CAT_NOT_FOUND, or CAT_SYSTEM_GROUP_LOCKED.
 */
export async function updateFacetGroup(
  tx: TxQuery,
  id: number,
  patch: Partial<FacetGroupFields>
): Promise<Change<FacetGroup> | CatalogRefusal> {
  const before = await lockGroup(tx, id);
  if (before === null) return 'CAT_NOT_FOUND';
  if (before.isSystem && patch.isActive === false)
    return 'CAT_SYSTEM_GROUP_LOCKED';
  const after = { ...before, ...patch };
  await tx.query(
    'UPDATE product_facet_groups SET name_es = ?, name_en = ?, is_required = ?, is_ordered = ?, is_filterable = ?, show_on_landing = ?, is_active = ?, sort_order = ? WHERE id = ?',
    [
      after.nameEs,
      after.nameEn,
      after.isRequired ? 1 : 0,
      after.isOrdered ? 1 : 0,
      after.isFilterable ? 1 : 0,
      after.showOnLanding ? 1 : 0,
      after.isActive ? 1 : 0,
      after.sortOrder,
      id,
    ]
  );
  return { before, after };
}

/**
 * Adds a value to a group. The system group's values mirror `experience_levels` (T2.6), so
 * they are never added by hand.
 *
 * @param tx - The transaction of the request.
 * @param groupId - The group.
 * @param input - Code, labels and order.
 * @returns The new value, CAT_NOT_FOUND, or CAT_SYSTEM_GROUP_LOCKED.
 * @throws The driver's ER_DUP_ENTRY when the group already has that code.
 */
export async function createFacetValue(
  tx: TxQuery,
  groupId: number,
  input: Omit<FacetValue, 'id'>
): Promise<Change<FacetValue> | CatalogRefusal> {
  const group = await lockGroup(tx, groupId);
  if (group === null) return 'CAT_NOT_FOUND';
  if (group.isSystem) return 'CAT_SYSTEM_GROUP_LOCKED';
  await tx.query(
    'INSERT INTO product_facet_values (group_id, code, value_es, value_en, sort_order) VALUES (?, ?, ?, ?, ?)',
    [groupId, input.code, input.valueEs, input.valueEn, input.sortOrder]
  );
  const [row] = await tx.query<ValueRow>(
    'SELECT id, group_id, code, value_es, value_en, sort_order FROM product_facet_values WHERE group_id = ? AND code = ?',
    [groupId, input.code]
  );
  return { before: null, after: valueOf(row) };
}

/**
 * Relabels or reorders a value; its code never changes. A value of the system group is
 * locked, like its group's values.
 *
 * @param tx - The transaction of the request.
 * @param id - The value.
 * @param patch - The fields to change.
 * @returns The change, CAT_NOT_FOUND, or CAT_SYSTEM_GROUP_LOCKED.
 */
export async function updateFacetValue(
  tx: TxQuery,
  id: number,
  patch: Partial<Pick<FacetValue, 'valueEs' | 'valueEn' | 'sortOrder'>>
): Promise<Change<FacetValue> | CatalogRefusal> {
  const [row] = await tx.query<ValueRow & { is_system: number }>(
    'SELECT v.id, v.group_id, v.code, v.value_es, v.value_en, v.sort_order, g.is_system FROM product_facet_values v JOIN product_facet_groups g ON g.id = v.group_id WHERE v.id = ? FOR UPDATE',
    [id]
  );
  if (!row) return 'CAT_NOT_FOUND';
  if (flag(row.is_system)) return 'CAT_SYSTEM_GROUP_LOCKED';
  const before = valueOf(row);
  const after = { ...before, ...patch };
  await tx.query(
    'UPDATE product_facet_values SET value_es = ?, value_en = ?, sort_order = ? WHERE id = ?',
    [after.valueEs, after.valueEn, after.sortOrder, id]
  );
  return { before, after };
}
