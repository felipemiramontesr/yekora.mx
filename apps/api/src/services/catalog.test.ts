import { describe, expect, it } from 'vitest';
import { findProduct, listProducts, type ProductRow } from './catalog';
import type { Db } from './db';

const tent: ProductRow = {
  sku: 'DEV-0002',
  slug: 'tienda-expedicion',
  name_es: 'Tienda de expedición',
  name_en: 'Expedition tent',
  description_es: 'Cuatro estaciones.',
  description_en: 'Four seasons.',
  price_mxn_cents: 485000,
  stock: 3,
  discipline: 'montana',
  discipline_name_es: 'Montaña',
  discipline_name_en: 'Mountaineering',
  level: 'expedicion',
  level_name_es: 'Expedición',
  level_name_en: 'Expedition',
};

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

describe('listProducts', () => {
  it('binds filters, sort, language and paging as parameters, never as SQL text', async () => {
    const { db, calls } = scriptedDb([{ total: '7' }], [tent]);
    const page = await listProducts(db, {
      discipline: 'montana',
      level: null,
      sort: 'price_desc',
      lang: 'en',
      page: 3,
      pageSize: 2,
    });
    expect(page).toEqual({ items: [tent], total: 7 });
    expect(calls[0].params).toEqual(['montana', 'montana', null, null]);
    expect(calls[1].params).toEqual([
      'montana',
      'montana',
      null,
      null,
      'price_desc',
      'price_desc',
      'en',
      2,
      4,
    ]);
    for (const { sql } of calls) {
      expect(sql).not.toContain('montana');
      expect(sql).toContain(
        'p.is_active = 1 AND c.is_active = 1 AND l.is_active = 1'
      );
    }
  });

  it('starts the first page at offset 0', async () => {
    const { db, calls } = scriptedDb([{ total: 0 }], []);
    await expect(
      listProducts(db, {
        discipline: null,
        level: null,
        sort: 'name',
        lang: 'es-MX',
        page: 1,
        pageSize: 24,
      })
    ).resolves.toEqual({ items: [], total: 0 });
    expect(calls[1].params.at(-1)).toBe(0);
  });
});

describe('findProduct', () => {
  it('returns the product with its images in display order', async () => {
    const image = {
      path: '/images/products/tent.webp',
      alt_es: 'Tienda',
      alt_en: 'Tent',
    };
    const { db, calls } = scriptedDb([tent], [image]);
    await expect(findProduct(db, 'tienda-expedicion')).resolves.toEqual({
      product: tent,
      images: [image],
    });
    expect(calls.map((call) => call.params)).toEqual([
      ['tienda-expedicion'],
      ['tienda-expedicion'],
    ]);
    expect(calls[1].sql).toContain('ORDER BY i.sort_order ASC');
  });

  it('returns null for an unknown or inactive product, without loading images', async () => {
    const { db, calls } = scriptedDb([]);
    await expect(findProduct(db, 'no-existe')).resolves.toBeNull();
    expect(calls).toHaveLength(1);
  });
});
