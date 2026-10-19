import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import fixture from '@/e2e/fixtures/catalog.json';
import {
  EMPTY_SNAPSHOT,
  findProduct,
  loadSnapshot,
  parseSnapshot,
  PLACEHOLDER_SLUG,
  productParams,
  SNAPSHOT_FILE,
  snapshotFrom,
} from './snapshot';

const dir = mkdtempSync(join(tmpdir(), 'yekora-snapshot-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const snapshot = parseSnapshot(fixture);

describe('parseSnapshot', () => {
  it('accepts the E2E fixture (the canonical row included)', () => {
    expect(snapshot.products.en[0]).toMatchObject({
      priceMxnCents: 485000,
      priceUsdCents: 26216,
    });
  });

  it('refuses languages that disagree on the products (hreflang would 404)', () => {
    expect(() =>
      parseSnapshot({
        ...fixture,
        products: { ...fixture.products, en: fixture.products.en.slice(1) },
      })
    ).toThrow('es-MX and en must list the same products');
  });
});

describe('snapshotFrom', () => {
  it('joins both languages and keeps the FIX of the read', () => {
    expect(
      snapshotFrom(
        {
          exchangeRate: snapshot.exchangeRate,
          products: snapshot.products['es-MX'],
        },
        { exchangeRate: snapshot.exchangeRate, products: snapshot.products.en }
      )
    ).toEqual(snapshot);
  });
});

describe('loadSnapshot', () => {
  it('is the empty catalog when no snapshot was written (next dev, production until K-07)', () => {
    expect(loadSnapshot(join(dir, 'missing.json'))).toBe(EMPTY_SNAPSHOT);
  });

  it('reads and validates a written snapshot', () => {
    const file = join(dir, 'ok.json');
    writeFileSync(file, JSON.stringify(fixture));
    expect(loadSnapshot(file)).toEqual(snapshot);
  });

  it('never turns a corrupt snapshot into an empty catalog', () => {
    const file = join(dir, 'bad.json');
    writeFileSync(file, JSON.stringify({ products: {} }));
    expect(() => loadSnapshot(file)).toThrow();
  });

  it('reads .catalog/snapshot.json under the working directory by default', () => {
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(dir);
    expect(SNAPSHOT_FILE).toBe(join('.catalog', 'snapshot.json'));
    expect(loadSnapshot()).toBe(EMPTY_SNAPSHOT);
    cwd.mockRestore();
  });
});

describe('productParams', () => {
  it('lists one param per product', () => {
    expect(productParams(snapshot, 'es-MX')).toEqual([
      { slug: 'e2e-arnes-alpino' },
      { slug: 'e2e-mochila-ligera-28l' },
      { slug: 'e2e-tenis-trail' },
    ]);
  });

  it('gives an empty catalog only the placeholder, which no real slug can match', () => {
    expect(productParams(EMPTY_SNAPSHOT, 'en')).toEqual([
      { slug: PLACEHOLDER_SLUG },
    ]);
    expect(PLACEHOLDER_SLUG).not.toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });
});

describe('findProduct', () => {
  it('finds a product in the language of the page', () => {
    expect(findProduct(snapshot, 'en', 'e2e-tenis-trail')?.name).toBe(
      'Trail shoes (E2E test)'
    );
  });

  it('is undefined for the placeholder or an unknown slug', () => {
    expect(findProduct(snapshot, 'en', PLACEHOLDER_SLUG)).toBeUndefined();
    expect(findProduct(EMPTY_SNAPSHOT, 'es-MX', 'x')).toBeUndefined();
  });
});
