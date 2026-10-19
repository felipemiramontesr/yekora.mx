import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import fixture from '@/e2e/fixtures/catalog.json';
import { EMPTY_SNAPSHOT, parseSnapshot } from '@/lib/catalog/snapshot';
import { CatalogView } from './CatalogView';

const snapshot = parseSnapshot(fixture);

describe('CatalogView', () => {
  it('shows «Próximamente» while the catalog is empty, pointing to the disciplines', () => {
    const html = renderToStaticMarkup(
      <CatalogView locale="es-MX" snapshot={EMPTY_SNAPSHOT} />
    );
    expect(html).toContain('<h1');
    expect(html).toContain('data-coming-soon');
    expect(html).toContain('Próximamente');
    expect(html).toContain('href="/#disciplinas"');
    expect(html).not.toContain('<select');
  });

  it('shows the English empty state', () => {
    const html = renderToStaticMarkup(
      <CatalogView locale="en" snapshot={EMPTY_SNAPSHOT} />
    );
    expect(html).toContain('Coming soon');
    expect(html).toContain('href="/en/#disciplinas"');
  });

  it('lists the products with filters and the FIX note in English', () => {
    const html = renderToStaticMarkup(
      <CatalogView locale="en" snapshot={snapshot} />
    );
    expect(html).not.toContain('data-coming-soon');
    expect(html).toContain('<select');
    expect(html).toContain('href="/en/catalog/e2e-arnes-alpino/"');
    expect(html).toContain('≈ $262.16 USD');
    expect(html).toContain('October 16, 2026');
  });

  it('lists the products in pesos only in Spanish', () => {
    const html = renderToStaticMarkup(
      <CatalogView locale="es-MX" snapshot={snapshot} />
    );
    expect(html).toContain('href="/catalogo/e2e-tenis-trail/"');
    expect(html).toContain('$2,599.00 MXN');
    expect(html).toContain('Precios en pesos mexicanos (MXN).');
    expect(html).not.toContain('≈');
  });
});
