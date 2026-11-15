/**
 * FC 029 F2b2 evidence: products of the backoffice. Creating, editing, retiring and arranging
 * a gallery run through the mutation pipeline (catalog:write, Idempotency-Key, payload, audit);
 * a product has no level (FC 048) and its property values are exactly the list given (T2.6);
 * nothing is deleted (T2.3c); the stock never drops below the reserved units; every reference
 * must exist and be active.
 *
 * The database is a small in-memory model answering each statement by its text, so the real
 * guard, routes and services run unchanged.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { ROUTE_CONTRACTS } from '../contract';
import { tokenHash } from '../services/authCrypto';
import type { Db, Transactional } from '../services/db';

const KEY = Buffer.alloc(32, 7).toString('base64');
const EDITOR = 'f0000000-0000-4000-8000-000000000001';
const SESSION = `__Host-yekora_session=${'e'.repeat(43)}`;
const sha = (letter: string) => letter.repeat(64);

/* ---------- the in-memory model ---------- */

const CATEGORIES: Record<string, number> = { montana: 1, retirada: 9 };
const SHIPPING: Record<string, number> = { estandar: 1 };
const BRANDS: Record<number, number> = { 5: 1, 6: 0 };
/** Property values: id → [code, groupActive]. */
const VALUES: Record<number, [string, number]> = {
  20: ['nylon', 1],
  22: ['algodon', 1],
  21: ['viejo', 0],
};
const slugOf = (table: Record<string, number>, id: unknown) =>
  Object.keys(table).find((key) => table[key] === id);

interface Row {
  id: number;
  sku: string;
  slug: string;
  category_id: number;
  brand_id: number | null;
  shipping_class_id: number;
  fields: unknown[];
  stock: number;
  reserved_stock: number;
  is_active: number;
}

const model = {
  products: [] as Row[],
  links: [] as [number, number][],
  media: [] as {
    id: number;
    product_id: number;
    media_sha256: string;
    alt_text_es: string | null;
    alt_text_en: string | null;
    sort_order: number;
    is_primary: number;
    is_active: number;
  }[],
  blobs: new Set<string>(),
  keys: new Map<string, Record<string, unknown>>(),
  audit: [] as unknown[][],
};

const rowOut = (row: Row) => {
  const [nameEs, nameEn, descEs, descEn, price, weight, length, width, height] =
    row.fields;
  return {
    id: row.id,
    sku: row.sku,
    slug: row.slug,
    name_es: nameEs,
    name_en: nameEn,
    description_es: descEs,
    description_en: descEn,
    price_mxn_cents: price,
    stock: row.stock,
    reserved_stock: row.reserved_stock,
    discipline: slugOf(CATEGORIES, row.category_id),
    brand_id: row.brand_id,
    shipping_class: slugOf(SHIPPING, row.shipping_class_id),
    weight_grams: weight,
    length_mm: length,
    width_mm: width,
    height_mm: height,
    is_active: row.is_active,
    is_test: 0,
  };
};

type Handler = (p: readonly unknown[]) => unknown[];
const HANDLERS: [string, Handler][] = [
  [
    'SELECT s.id, s.user_id',
    (p) =>
      p[0] === tokenHash('e'.repeat(43))
        ? [
            {
              id: p[0],
              user_id: EDITOR,
              email: 'x@example.test',
              full_name: 'X',
            },
          ]
        : [],
  ],
  [
    'SELECT ur.role_id',
    () => [{ role_id: 'staff_catalog', permission_id: 'catalog:write' }],
  ],
  ['SELECT is_totp_enabled', () => [{ is_totp_enabled: 1 }]],
  [
    'SELECT route, request_hash',
    (p) => {
      const row = model.keys.get(p[0] as string);
      return row ? [row] : [];
    },
  ],
  [
    'INSERT INTO idempotency_keys',
    (p) => {
      model.keys.set(p[0] as string, {
        route: p[2],
        request_hash: p[3],
        response_status: p[4],
        response_body: p[6],
        expires_at: p[7],
      });
      return [];
    },
  ],
  [
    'INSERT INTO audit_log',
    (p) => {
      model.audit.push([...p]);
      return [];
    },
  ],
  [
    'SELECT COUNT(*) AS total FROM products',
    () => [{ total: model.products.length }],
  ],
  [
    'SELECT id FROM categories',
    (p) => {
      const id = CATEGORIES[p[0] as string];
      return id && id !== 9 ? [{ id }] : [];
    },
  ],
  [
    'SELECT id FROM shipping_classes',
    (p) => (SHIPPING[p[0] as string] ? [{ id: 1 }] : []),
  ],
  [
    'SELECT id FROM brands',
    (p) => (BRANDS[p[0] as number] === 1 ? [{ id: p[0] }] : []),
  ],
  [
    'SELECT g.is_active FROM product_facet_values v',
    (p) => {
      const value = VALUES[p[0] as number];
      return value ? [{ is_active: value[1] }] : [];
    },
  ],
  [
    'INSERT INTO products',
    (p) => {
      if (model.products.some((row) => row.sku === p[0]))
        throw Object.assign(new Error('Duplicate entry'), {
          code: 'ER_DUP_ENTRY',
        });
      model.products.push({
        id: model.products.length + 1,
        sku: p[0] as string,
        slug: p[1] as string,
        category_id: p[2] as number,
        brand_id: p[3] as number | null,
        fields: [p[4], p[5], p[6], p[7], p[8], p[10], p[11], p[12], p[13]],
        stock: p[9] as number,
        reserved_stock: 0,
        shipping_class_id: p[14] as number,
        is_active: 1,
      });
      return [];
    },
  ],
  [
    'SELECT id FROM products WHERE sku',
    (p) =>
      model.products.filter((r) => r.sku === p[0]).map((r) => ({ id: r.id })),
  ],
  [
    'SELECT id FROM products WHERE id',
    (p) =>
      model.products.filter((r) => r.id === p[0]).map((r) => ({ id: r.id })),
  ],
  [
    'SELECT p.id, p.sku',
    (p) => {
      const rows =
        p.length === 1
          ? model.products.filter((r) => r.id === p[0])
          : model.products;
      return rows.map(rowOut);
    },
  ],
  [
    'UPDATE products SET',
    (p) => {
      const row = model.products.find((r) => r.id === p[14]) as Row;
      Object.assign(row, {
        category_id: p[0],
        brand_id: p[1],
        fields: [p[2], p[3], p[4], p[5], p[6], p[8], p[9], p[10], p[11]],
        stock: p[7],
        shipping_class_id: p[12],
        is_active: p[13],
      });
      return [];
    },
  ],
  [
    'DELETE FROM product_facet_links WHERE product_id = ?',
    (p) => {
      model.links = model.links.filter(([pid]) => pid !== p[0]);
      return [];
    },
  ],
  [
    'INSERT INTO product_facet_links (product_id, value_id) VALUES',
    (p) => {
      model.links.push([p[0] as number, p[1] as number]);
      return [];
    },
  ],
  [
    'SELECT value_id FROM product_facet_links',
    (p) =>
      model.links
        .filter(([pid]) => pid === p[0])
        .map(([, vid]) => ({ value_id: vid })),
  ],
  [
    'SELECT media_sha256',
    (p) =>
      model.media
        .filter((m) => m.product_id === p[0] && m.is_active === 1)
        .sort(
          (a, b) => b.is_primary - a.is_primary || a.sort_order - b.sort_order
        ),
  ],
  [
    'SELECT sha256 FROM media_blobs',
    (p) => (model.blobs.has(p[0] as string) ? [{ sha256: p[0] }] : []),
  ],
  [
    'UPDATE product_media SET is_active = 0',
    (p) => {
      for (const m of model.media)
        if (m.product_id === p[0])
          Object.assign(m, { is_active: 0, is_primary: 0 });
      return [];
    },
  ],
  [
    'SELECT id FROM product_media',
    (p) =>
      model.media
        .filter((m) => m.product_id === p[0] && m.media_sha256 === p[1])
        .map((m) => ({ id: m.id })),
  ],
  [
    'UPDATE product_media SET alt_text_es',
    (p) => {
      const m = model.media.find((row) => row.id === p[4]);
      Object.assign(m ?? {}, {
        alt_text_es: p[0],
        alt_text_en: p[1],
        sort_order: p[2],
        is_primary: p[3],
        is_active: 1,
      });
      return [];
    },
  ],
  [
    'INSERT INTO product_media',
    (p) => {
      model.media.push({
        id: model.media.length + 1,
        alt_text_es: p[0] as string | null,
        alt_text_en: p[1] as string | null,
        sort_order: p[2] as number,
        is_primary: p[3] as number,
        product_id: p[4] as number,
        media_sha256: p[5] as string,
        is_active: 1,
      });
      return [];
    },
  ],
];

const db: Db & Transactional = {
  async query<R>(text: string, params: readonly unknown[] = []) {
    const handler = HANDLERS.find(([start]) => text.startsWith(start));
    return (handler ? handler[1](params) : []) as R[];
  },
  ping: async () => undefined,
  transaction(work) {
    return work(this);
  },
  close: async () => undefined,
};

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({
    config: loadConfig({
      DB_HOST: '127.0.0.1',
      DB_USER: 'root',
      DB_NAME: 'yekora_dev',
      AUTH_SECRET: KEY,
      TOTP_ENCRYPTION_KEY: KEY,
    }),
    db,
    rate: async () => null,
    logger: false,
    now: () => new Date('2026-11-07T18:00:00Z'),
  });
  await app.ready();
}, 30_000);

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  model.products.length = 0;
  model.links = [];
  model.media.length = 0;
  model.blobs = new Set([sha('a'), sha('b'), sha('c')]);
  model.keys.clear();
  model.audit.length = 0;
});

let counter = 0;
const write = (method: 'POST' | 'PATCH', url: string, payload: unknown) =>
  app.inject({
    method,
    url,
    headers: { cookie: SESSION, 'idempotency-key': `k-${++counter}` },
    payload: payload as Record<string, unknown>,
  });
const read = (url: string) => app.inject({ url, headers: { cookie: SESSION } });

const pack = {
  sku: 'PACK-30',
  slug: 'mochila-30',
  nameEs: 'Mochila 30 L',
  nameEn: 'Pack 30 L',
  descriptionEs: 'Ligera.',
  descriptionEn: 'Light.',
  priceMxnCents: 185000,
  stock: 4,
  discipline: 'montana',
  shippingClass: 'estandar',
  weightGrams: 900,
  lengthMm: 500,
  widthMm: 300,
  heightMm: 200,
};
const create = (overrides: Record<string, unknown> = {}) =>
  write('POST', '/v1/admin/catalog/products', { ...pack, ...overrides });

describe('products of the backoffice (FC 029 F2b2)', () => {
  it('creates a product (201) with its brand and property values, and its audit (T2.6, T2.4)', async () => {
    const res = await create({ brandId: 5, facetValueIds: [20] });
    expect(res.statusCode).toBe(201);
    const created = res.json();
    expect(created).toMatchObject({
      id: 1,
      sku: 'PACK-30',
      brandId: 5,
      isActive: true,
      facetValueIds: [20],
      gallery: [],
    });
    // FC 048: a product has no level, nor a «Nivel» value of its own.
    expect(created).not.toHaveProperty('level');
    const route = ROUTE_CONTRACTS.find(
      (r) => r.method === 'POST' && r.path === '/v1/admin/catalog/products'
    );
    expect(route?.responses[201].safeParse(created).success).toBe(true);
    const entry = model.audit.find((row) => row[2] === 'products');
    expect(JSON.parse(entry?.[5] as string)).toMatchObject({
      nameEs: 'Mochila 30 L',
    });
  });

  it('refuses a level: it is no field of a product any more (400)', async () => {
    const res = await create({ level: 'principiante' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ detail: 'CAT_VALIDATION_ERROR' });
  });

  it.each([
    ['a retired discipline', { discipline: 'retirada' }],
    ['an unknown shipping class', { shippingClass: 'flete' }],
    ['a retired brand', { brandId: 6 }],
    ['a value of a retired group', { facetValueIds: [21] }],
    ['an unknown value', { facetValueIds: [99] }],
  ])('refuses %s with 422 CAT_REFERENCE_INVALID', async (_case, overrides) => {
    const res = await create(overrides);
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ detail: 'CAT_REFERENCE_INVALID' });
    expect(model.products).toHaveLength(0);
  });

  it('refuses a taken SKU with 409 CAT_CONFLICT', async () => {
    await create();
    const res = await create({ slug: 'otra' });
    expect(res.json()).toMatchObject({ detail: 'CAT_CONFLICT' });
  });

  it.each([
    ['a lowercase SKU', { sku: 'pack' }],
    ['a zero price', { priceMxnCents: 0 }],
    ['a negative stock', { stock: -1 }],
    ['an unknown field', { color: 'rojo' }],
  ])('refuses %s with 400 CAT_VALIDATION_ERROR', async (_case, overrides) => {
    const res = await create(overrides);
    expect(res.json()).toMatchObject({ detail: 'CAT_VALIDATION_ERROR' });
  });

  it('edits a product, replaces its property values, and retires it with isActive false (T2.3c)', async () => {
    await create({ facetValueIds: [20] });
    const res = await write('PATCH', '/v1/admin/catalog/products/1', {
      priceMxnCents: 199000,
      isActive: false,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      priceMxnCents: 199000,
      isActive: false,
      facetValueIds: [20],
    });
    const replaced = await write('PATCH', '/v1/admin/catalog/products/1', {
      facetValueIds: [22, 22],
    });
    expect(replaced.json()).toMatchObject({
      facetValueIds: [22],
      isActive: false,
    });
    const cleared = await write('PATCH', '/v1/admin/catalog/products/1', {
      facetValueIds: [],
    });
    expect(cleared.json()).toMatchObject({ facetValueIds: [] });
  });

  it('keeps the stock at or above the reserved units (409 CAT_STOCK_BELOW_RESERVED)', async () => {
    await create();
    model.products[0].reserved_stock = 3;
    const res = await write('PATCH', '/v1/admin/catalog/products/1', {
      stock: 2,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ detail: 'CAT_STOCK_BELOW_RESERVED' });
  });

  it.each([
    [{ level: 'experto' }, 'CAT_VALIDATION_ERROR'],
    [{ facetValueIds: [99] }, 'CAT_REFERENCE_INVALID'],
    [{ brandId: 6 }, 'CAT_REFERENCE_INVALID'],
  ])('refuses the edit %j with %s', async (patch, code) => {
    await create();
    const res = await write('PATCH', '/v1/admin/catalog/products/1', patch);
    expect(res.json()).toMatchObject({ detail: code });
  });

  it('answers an unknown product 404 on every write and on the detail', async () => {
    for (const url of [
      '/v1/admin/catalog/products/9',
      '/v1/admin/catalog/products/9/media',
    ]) {
      const res = await write(
        'PATCH',
        url,
        url.endsWith('media') ? { images: [] } : { stock: 1 }
      );
      expect(res.json()).toMatchObject({ detail: 'CAT_NOT_FOUND' });
    }
    const detail = await read('/v1/admin/catalog/products/9');
    expect(detail.statusCode).toBe(404);
    const bad = await read('/v1/admin/catalog/products/nine');
    expect(bad.statusCode).toBe(400);
  });

  it('arranges the gallery in order, first primary; an image that leaves is retired, and comes back', async () => {
    await create();
    const first = await write('PATCH', '/v1/admin/catalog/products/1/media', {
      images: [{ sha256: sha('a'), altEs: 'Frente' }, { sha256: sha('b') }],
    });
    expect(first.json().gallery).toEqual([
      {
        sha256: sha('a'),
        altEs: 'Frente',
        altEn: null,
        sortOrder: 0,
        isPrimary: true,
      },
      {
        sha256: sha('b'),
        altEs: null,
        altEn: null,
        sortOrder: 1,
        isPrimary: false,
      },
    ]);
    await write('PATCH', '/v1/admin/catalog/products/1/media', {
      images: [{ sha256: sha('b') }],
    });
    expect(
      model.media.find((m) => m.media_sha256 === sha('a'))?.is_active
    ).toBe(0);
    const back = await write('PATCH', '/v1/admin/catalog/products/1/media', {
      images: [{ sha256: sha('a') }, { sha256: sha('b') }],
    });
    expect(
      back.json().gallery.map((g: { sha256: string }) => g.sha256)
    ).toEqual([sha('a'), sha('b')]);
    expect(model.media).toHaveLength(2);
  });

  it('refuses an image never uploaded (422) and the same image twice (400)', async () => {
    await create();
    const unknown = await write('PATCH', '/v1/admin/catalog/products/1/media', {
      images: [{ sha256: sha('f') }],
    });
    expect(unknown.json()).toMatchObject({ detail: 'CAT_REFERENCE_INVALID' });
    const twice = await write('PATCH', '/v1/admin/catalog/products/1/media', {
      images: [{ sha256: sha('a') }, { sha256: sha('a') }],
    });
    expect(twice.json()).toMatchObject({ detail: 'CAT_VALIDATION_ERROR' });
  });

  it('lists every product, active or not, by page', async () => {
    await create();
    await create({ sku: 'PACK-40', slug: 'mochila-40' });
    await write('PATCH', '/v1/admin/catalog/products/2', { isActive: false });
    const res = await read('/v1/admin/catalog/products?page=1&pageSize=10');
    expect(res.json()).toMatchObject({ total: 2, page: 1, pageSize: 10 });
    expect(
      res.json().items.map((p: { isActive: boolean }) => p.isActive)
    ).toEqual([true, false]);
    const restocked = await write('PATCH', '/v1/admin/catalog/products/1', {
      stock: 9,
    });
    expect(restocked.json()).toMatchObject({ stock: 9, isActive: true });
    const detail = await read('/v1/admin/catalog/products/1');
    expect(detail.json()).toMatchObject({ sku: 'PACK-30', facetValueIds: [] });
    expect(
      (await read('/v1/admin/catalog/products?pageSize=500')).statusCode
    ).toBe(400);
  });
});
