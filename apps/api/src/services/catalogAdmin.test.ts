import { describe, expect, it } from 'vitest';
import {
  createBrand,
  createFacetGroup,
  createFacetValue,
  listBrands,
  listFacets,
  updateBrand,
  updateFacetGroup,
  updateFacetValue,
} from './catalogAdmin';
import type { Db } from './db';

/** Db port that answers each statement from a queue and records what it received. */
function scriptedDb(...answers: unknown[][]) {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const db: Db = {
    async query<Row>(sql: string, params: readonly unknown[] = []) {
      calls.push({ sql, params });
      return (answers.shift() ?? []) as Row[];
    },
    ping: async () => undefined,
    close: async () => undefined,
  };
  return { db, calls };
}

const brandRow = {
  id: 3,
  slug: 'cumbre',
  name: 'Cumbre',
  website: null,
  is_active: 1,
};
const brand = {
  id: 3,
  slug: 'cumbre',
  name: 'Cumbre',
  website: null,
  isActive: true,
};

const groupRow = (overrides: Record<string, unknown> = {}) => ({
  id: 2,
  code: 'material',
  name_es: 'Material',
  name_en: 'Material',
  is_required: 0,
  is_ordered: 0,
  is_filterable: 1,
  show_on_landing: 0,
  is_system: 0,
  is_active: 1,
  sort_order: 5,
  ...overrides,
});
const valueRow = {
  id: 9,
  group_id: 2,
  code: 'nylon',
  value_es: 'Nailon',
  value_en: 'Nylon',
  sort_order: 1,
};
const value = {
  id: 9,
  code: 'nylon',
  valueEs: 'Nailon',
  valueEn: 'Nylon',
  sortOrder: 1,
};

describe('brands (FC 029 F2b)', () => {
  it('lists every brand, active or not', async () => {
    const { db, calls } = scriptedDb([
      brandRow,
      { ...brandRow, id: 4, is_active: 0 },
    ]);
    const brands = await listBrands(db);
    expect(brands.map((b) => b.isActive)).toEqual([true, false]);
    expect(calls[0].sql).not.toContain('WHERE');
  });

  it('creates a brand and answers it as stored', async () => {
    const { db, calls } = scriptedDb([], [brandRow]);
    await expect(
      createBrand(db, { slug: 'cumbre', name: 'Cumbre', website: null })
    ).resolves.toEqual({ before: null, after: brand });
    expect(calls[0].params).toEqual(['cumbre', 'Cumbre', null]);
  });

  it('retires a brand with is_active = 0, never a DELETE (T2.3c)', async () => {
    const { db, calls } = scriptedDb([brandRow]);
    await expect(updateBrand(db, 3, { isActive: false })).resolves.toEqual({
      before: brand,
      after: { ...brand, isActive: false },
    });
    expect(calls[0].sql).toContain('FOR UPDATE');
    expect(calls[1].sql).toMatch(/^UPDATE brands SET/);
    expect(calls[1].params).toEqual(['Cumbre', null, 0, 3]);
  });

  it('keeps an active brand active when only renamed', async () => {
    const { db, calls } = scriptedDb([brandRow]);
    await updateBrand(db, 3, { name: 'Cumbre MX' });
    expect(calls[1].params).toEqual(['Cumbre MX', null, 1, 3]);
  });

  it('names an unknown brand CAT_NOT_FOUND and writes nothing', async () => {
    const { db, calls } = scriptedDb([]);
    await expect(updateBrand(db, 99, { name: 'X' })).resolves.toBe(
      'CAT_NOT_FOUND'
    );
    expect(calls).toHaveLength(1);
  });
});

describe('facets (FC 029 F2b, T2.1b)', () => {
  it('lists every group with its own values', async () => {
    const { db } = scriptedDb(
      [groupRow(), groupRow({ id: 1, code: 'nivel', is_system: 1 })],
      [valueRow, { ...valueRow, id: 10, group_id: 1, code: 'experto' }]
    );
    const groups = await listFacets(db);
    expect(groups[0]).toMatchObject({
      code: 'material',
      isFilterable: true,
      isSystem: false,
      values: [value],
    });
    expect(groups[1].values.map((v) => v.code)).toEqual(['experto']);
  });

  it('creates a group, never a system one, with its flags as 0 or 1', async () => {
    const { db, calls } = scriptedDb([], [groupRow()]);
    const change = await createFacetGroup(db, {
      code: 'material',
      nameEs: 'Material',
      nameEn: 'Material',
      isRequired: true,
      isOrdered: false,
      isFilterable: true,
      showOnLanding: false,
      sortOrder: 5,
    });
    expect(change.before).toBeNull();
    expect(change.after).toMatchObject({ code: 'material', isSystem: false });
    expect(calls[0].sql).not.toContain('is_system');
    const inverted = scriptedDb([], [groupRow()]);
    await createFacetGroup(inverted.db, {
      code: 'peso',
      nameEs: 'Peso',
      nameEn: 'Weight',
      isRequired: false,
      isOrdered: true,
      isFilterable: false,
      showOnLanding: true,
      sortOrder: 0,
    });
    expect(inverted.calls[0].params.slice(3, 7)).toEqual([0, 1, 0, 1]);
    expect(calls[0].params).toEqual([
      'material',
      'Material',
      'Material',
      1,
      0,
      1,
      0,
      5,
    ]);
  });

  it('retires an ordinary group with is_active = 0 (T2.3c)', async () => {
    const { db, calls } = scriptedDb([
      groupRow({ is_ordered: 1, show_on_landing: 1, is_required: 1 }),
    ]);
    const change = await updateFacetGroup(db, 2, { isActive: false });
    expect(change).toMatchObject({ after: { isActive: false } });
    expect(calls[1].params).toEqual([
      'Material',
      'Material',
      1,
      1,
      1,
      1,
      0,
      5,
      2,
    ]);
  });

  it('never retires the system group Nivel, but lets it be renamed (T2.1b)', async () => {
    const nivel = groupRow({
      id: 1,
      code: 'nivel',
      is_system: 1,
      is_filterable: 0,
    });
    const locked = scriptedDb([nivel]);
    await expect(
      updateFacetGroup(locked.db, 1, { isActive: false })
    ).resolves.toBe('CAT_SYSTEM_GROUP_LOCKED');
    expect(locked.calls).toHaveLength(1);
    const renamed = scriptedDb([nivel]);
    await expect(
      updateFacetGroup(renamed.db, 1, { nameEn: 'Level' })
    ).resolves.toMatchObject({ after: { nameEn: 'Level', isActive: true } });
  });

  it('names an unknown group CAT_NOT_FOUND', async () => {
    await expect(
      updateFacetGroup(scriptedDb([]).db, 99, { sortOrder: 1 })
    ).resolves.toBe('CAT_NOT_FOUND');
  });

  it('adds a value to an ordinary group, never to the system group (T2.6)', async () => {
    const added = scriptedDb([groupRow()], [], [valueRow]);
    await expect(
      createFacetValue(added.db, 2, {
        code: 'nylon',
        valueEs: 'Nailon',
        valueEn: 'Nylon',
        sortOrder: 1,
      })
    ).resolves.toEqual({ before: null, after: value });
    expect(added.calls[1].params).toEqual([2, 'nylon', 'Nailon', 'Nylon', 1]);
    const input = { code: 'x', valueEs: 'X', valueEn: 'X', sortOrder: 0 };
    await expect(
      createFacetValue(scriptedDb([groupRow({ is_system: 1 })]).db, 1, input)
    ).resolves.toBe('CAT_SYSTEM_GROUP_LOCKED');
    await expect(createFacetValue(scriptedDb([]).db, 99, input)).resolves.toBe(
      'CAT_NOT_FOUND'
    );
  });

  it('relabels a value of an ordinary group; the system group’s stay locked', async () => {
    const edited = scriptedDb([{ ...valueRow, is_system: 0 }]);
    await expect(
      updateFacetValue(edited.db, 9, { valueEn: 'Nylon 6' })
    ).resolves.toEqual({
      before: value,
      after: { ...value, valueEn: 'Nylon 6' },
    });
    expect(edited.calls[1].params).toEqual(['Nailon', 'Nylon 6', 1, 9]);
    await expect(
      updateFacetValue(scriptedDb([{ ...valueRow, is_system: 1 }]).db, 9, {
        sortOrder: 2,
      })
    ).resolves.toBe('CAT_SYSTEM_GROUP_LOCKED');
    await expect(
      updateFacetValue(scriptedDb([]).db, 9, { sortOrder: 2 })
    ).resolves.toBe('CAT_NOT_FOUND');
  });
});
