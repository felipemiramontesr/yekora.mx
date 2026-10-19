import { describe, expect, it, vi } from 'vitest';
import { quoteCart } from './cartQuote';
import type { Db } from './db';

const FIX = { series: 'SF43718', date: '2026-10-19', rate: '18.5000' };

interface Row {
  sku: string;
  slug: string;
  name_es: string;
  name_en: string;
  price_mxn_cents: number;
  stock: number;
}

function product(sku: string, price: number, stock: number): Row {
  return {
    sku,
    slug: sku.toLowerCase(),
    name_es: `Producto ${sku}`,
    name_en: `Product ${sku}`,
    price_mxn_cents: price,
    stock,
  };
}

/** Db port answering the quote query from a fixed product list, like MariaDB's IN (?). */
function catalog(rows: Row[]) {
  const query = vi.fn(async (_sql: string, params: readonly unknown[] = []) => {
    const skus = new Set(params[0] as string[]);
    return rows.filter((row) => skus.has(row.sku));
  });
  return {
    db: { query, ping: vi.fn(), close: vi.fn() } as unknown as Db,
    query,
  };
}

const quote = (
  lines: { sku: string; quantity: number }[],
  rows: Row[],
  rate: typeof FIX | null = FIX,
  lang: 'es-MX' | 'en' = 'es-MX'
) => quoteCart(catalog(rows).db, lines, rate, lang);

describe('VAT breakdown (T1.3 · 16 % inside the net price)', () => {
  it('matches the canonical rows of 073_AN', async () => {
    const result = await quote(
      [
        { sku: 'A', quantity: 3 },
        { sku: 'B', quantity: 1 },
      ],
      [product('A', 1160, 10), product('B', 35, 10)]
    );
    expect(
      result.items.map((i) => [
        i.lineTotalMxnCents,
        i.lineBaseMxnCents,
        i.lineTaxMxnCents,
      ])
    ).toEqual([
      [3480, 3000, 480], // 1 160 × 3
      [35, 30, 5], // rounding row
    ]);
  });

  it('adds up exactly for every net amount from 1 to 20 000 cents, VAT within one cent of 16 %', async () => {
    const rows = Array.from({ length: 20_000 }, (_, i) =>
      product(`P${i + 1}`, i + 1, 1)
    );
    const result = await quote(
      rows.map((row) => ({ sku: row.sku, quantity: 1 })),
      rows
    );
    const broken = result.items.filter((i) => {
      const base = i.lineBaseMxnCents ?? NaN;
      const tax = i.lineTaxMxnCents ?? NaN;
      return (
        base + tax !== i.lineTotalMxnCents || Math.abs(tax - base * 0.16) > 1
      );
    });
    expect(broken).toEqual([]);
    expect(result.summary.subtotalMxnCents + result.summary.taxMxnCents).toBe(
      result.summary.totalMxnCents
    );
  });
});

describe('quoteCart', () => {
  it('multiplies the net unit price exactly and totals the line', async () => {
    const result = await quote(
      [{ sku: 'TENT', quantity: 3 }],
      [product('TENT', 1160, 10)]
    );
    expect(result.items[0]).toEqual({
      sku: 'TENT',
      slug: 'tent',
      name: 'Producto TENT',
      quantity: 3,
      unitPriceMxnCents: 1160,
      lineTotalMxnCents: 3480,
      lineBaseMxnCents: 3000,
      lineTaxMxnCents: 480,
      stockStatus: 'available',
      availableQuantity: 10,
      purchasable: true,
    });
    expect(result.summary).toMatchObject({
      subtotalMxnCents: 3000,
      taxMxnCents: 480,
      totalMxnCents: 3480,
      totalItems: 3,
    });
    expect(result.warnings).toEqual([]);
  });

  it('derives the USD reference from the net total with the FC 008 formula', async () => {
    const result = await quote(
      [{ sku: 'HARNESS', quantity: 1 }],
      [product('HARNESS', 485000, 5)],
      FIX,
      'en'
    );
    expect(result.summary.referenceUsdCents).toBe(26216);
    expect(result.summary.exchangeRate).toEqual(FIX);
    expect(result.items[0].name).toBe('Product HARNESS');
  });

  it('shows pesos only without a FIX', async () => {
    const result = await quote(
      [{ sku: 'A', quantity: 1 }],
      [product('A', 1000, 9)],
      null
    );
    expect(result.summary.referenceUsdCents).toBeNull();
    expect(result.summary.exchangeRate).toBeNull();
  });

  it('classifies stock in disjoint states (T1.2)', async () => {
    const result = await quote(
      [
        { sku: 'PLENTY', quantity: 1 },
        { sku: 'FEW', quantity: 4 },
        { sku: 'NONE', quantity: 1 },
        { sku: 'SHORT', quantity: 3 },
      ],
      [
        product('PLENTY', 100, 5),
        product('FEW', 100, 4),
        product('NONE', 100, 0),
        product('SHORT', 100, 2),
      ]
    );
    expect(
      result.items.map((i) => [
        i.stockStatus,
        i.purchasable,
        i.availableQuantity,
      ])
    ).toEqual([
      ['available', true, 5],
      ['low_stock', true, 4],
      ['out_of_stock', false, 0],
      ['low_stock', false, 2],
    ]);
    expect(result.warnings).toEqual([
      { sku: 'NONE', code: 'out_of_stock' },
      { sku: 'SHORT', code: 'insufficient_stock' },
    ]);
  });

  it('only counts lines that can be bought now toward the totals', async () => {
    const result = await quote(
      [
        { sku: 'OK', quantity: 2 },
        { sku: 'SHORT', quantity: 3 },
        { sku: 'GONE', quantity: 1 },
      ],
      [product('OK', 1160, 10), product('SHORT', 9999, 1)]
    );
    expect(result.summary).toMatchObject({
      totalMxnCents: 2320,
      subtotalMxnCents: 2000,
      taxMxnCents: 320,
      totalItems: 2,
    });
  });

  it('returns unknown or inactive SKUs as unavailable, without amounts (T1.1 · HTTP 200)', async () => {
    const result = await quote([{ sku: 'GHOST', quantity: 2 }], [], FIX, 'en');
    expect(result.items[0]).toEqual({
      sku: 'GHOST',
      slug: null,
      name: null,
      quantity: 2,
      unitPriceMxnCents: null,
      lineTotalMxnCents: null,
      lineBaseMxnCents: null,
      lineTaxMxnCents: null,
      stockStatus: 'unavailable',
      availableQuantity: 0,
      purchasable: false,
    });
    expect(result.warnings).toEqual([{ sku: 'GHOST', code: 'unavailable' }]);
    expect(result.summary.totalMxnCents).toBe(0);
    expect(result.summary.referenceUsdCents).toBeNull();
  });

  it('caps the quantity it offers at 99 and never below 0', async () => {
    const result = await quote(
      [
        { sku: 'BULK', quantity: 1 },
        { sku: 'NEG', quantity: 1 },
      ],
      [product('BULK', 100, 500), product('NEG', 100, -3)],
      null
    );
    expect(result.items.map((i) => i.availableQuantity)).toEqual([99, 0]);
    expect(result.items[1].stockStatus).toBe('out_of_stock');
  });

  it('reads every SKU in one static, parameterized query', async () => {
    const { db, query } = catalog([product('A', 1160, 9)]);
    const result = await quoteCart(
      db,
      [
        { sku: 'A', quantity: 1 },
        { sku: "B' OR 1=1 --", quantity: 1 },
      ],
      FIX,
      'es-MX'
    );
    expect(query).toHaveBeenCalledOnce();
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('WHERE p.sku IN (?)');
    expect(sql).toContain(
      'p.is_active = 1 AND c.is_active = 1 AND l.is_active = 1'
    );
    expect(sql).not.toContain('OR 1=1');
    expect(params).toEqual([['A', "B' OR 1=1 --"]]);
    expect(result.items[1].stockStatus).toBe('unavailable');
  });

  it('does not touch the database for an empty cart', async () => {
    const { db, query } = catalog([]);
    await expect(quoteCart(db, [], FIX, 'en')).resolves.toEqual({
      items: [],
      summary: {
        subtotalMxnCents: 0,
        taxMxnCents: 0,
        totalMxnCents: 0,
        totalItems: 0,
        referenceUsdCents: null,
        exchangeRate: FIX,
      },
      warnings: [],
    });
    expect(query).not.toHaveBeenCalled();
  });
});
