import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  E2E_FREE_SHIPPING_FROM,
  E2E_STOCK,
  E2E_ZONE_RATES,
  type E2eFixture,
  e2eStackSeed,
} from './e2eStackSeed';

const fixture = JSON.parse(
  readFileSync('e2e/fixtures/catalog.json', 'utf8')
) as E2eFixture;

describe('e2eStackSeed (FC 026 T1.3)', () => {
  const statements = e2eStackSeed(fixture);

  it('writes the FIX, the zone-rate config with free shipping, then replaces the rules', () => {
    expect(statements[0].params).toEqual(['SF43718', '2026-10-16', '18.5000']);
    expect(statements[1].params).toEqual([2, E2E_FREE_SHIPPING_FROM]);
    expect(statements[2]).toEqual({
      sql: 'DELETE FROM shipping_rules',
      params: [],
    });
    expect(statements.slice(3, 5).map((s) => s.params)).toEqual(
      Object.entries(E2E_ZONE_RATES).map(([state, cents]) => [2, cents, state])
    );
  });

  it('upserts every fixture product with both languages and the stock the suites expect', () => {
    const products = statements.slice(5);
    expect(products.map((s) => s.params[0])).toEqual(Object.keys(E2E_STOCK));
    expect(products[1].params).toEqual([
      'E2E-0002',
      'e2e-mochila-ligera-28l',
      'Mochila ligera 28 L (prueba E2E)',
      'Light backpack 28 L (E2E test)',
      'Producto ficticio de la suite E2E. Nunca se publica.',
      'Fictitious product of the E2E suite. Never published.',
      185000,
      2,
      'principiante',
      'senderismo',
    ]);
  });

  it('keeps every value out of the SQL text', () => {
    for (const { sql, params } of statements) {
      expect(sql.split('?').length - 1).toBe(params.length);
      // Text values only: a number such as 10 also reads inside the fixed 1000 g of weight.
      for (const value of params) {
        if (typeof value === 'string') expect(sql).not.toContain(value);
      }
    }
  });

  it('refuses a product without its English twin or without E2E stock', () => {
    const [first] = fixture.products['es-MX'];
    expect(() =>
      e2eStackSeed({ ...fixture, products: { 'es-MX': [first], en: [] } })
    ).toThrow('E2E-0001 has no English entry');
    const stray = { ...first, sku: 'E2E-9999' };
    expect(() =>
      e2eStackSeed({
        ...fixture,
        products: { 'es-MX': [stray], en: [stray] },
      })
    ).toThrow('E2E-9999 has no E2E stock');
  });
});
