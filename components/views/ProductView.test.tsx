import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import fixture from '@/e2e/fixtures/catalog.json';
import { parseSnapshot } from '@/lib/catalog/snapshot';
import { ProductView } from './ProductView';

const snapshot = parseSnapshot(fixture);
const [harness, , shoes] = snapshot.products.en;

describe('ProductView', () => {
  it('shows name, references, both prices, the FIX note and the way back (English)', () => {
    const html = renderToStaticMarkup(
      <ProductView
        locale="en"
        product={harness}
        exchangeRate={snapshot.exchangeRate}
      />
    );
    expect(html).toContain('<h1');
    expect(html).toContain('Alpine harness (E2E test)');
    expect(html).toContain('Climbing');
    expect(html).toContain('Advanced');
    expect(html).toContain('$4,850.00 MXN');
    expect(html).toContain('≈ $262.16 USD');
    expect(html).toContain('18.5000 MXN per USD');
    expect(html).toContain('In stock');
    expect(html).toContain('E2E-0001');
    expect(html).toContain('href="/en/catalog/"');
    // No photo: the discipline pictogram stands in.
    expect(html).toContain('data-discipline="escalada"');
  });

  it('shows the gallery in order, the first photo eager and the rest lazy', () => {
    const html = renderToStaticMarkup(
      <ProductView
        locale="en"
        product={{
          ...shoes,
          images: [
            { path: '/images/products/a.webp', alt: 'Side' },
            { path: '/images/products/b.webp', alt: 'Sole' },
          ],
        }}
        exchangeRate={null}
      />
    );
    expect(html.indexOf('a.webp')).toBeLessThan(html.indexOf('b.webp'));
    expect(html.match(/loading="eager"/g)).toHaveLength(1);
    expect(html.match(/loading="lazy"/g)).toHaveLength(1);
    expect(html).toContain('Out of stock');
    expect(html).toContain('Prices in Mexican pesos (MXN).');
  });

  it('shows pesos only in Spanish', () => {
    const html = renderToStaticMarkup(
      <ProductView
        locale="es-MX"
        product={snapshot.products['es-MX'][0]}
        exchangeRate={snapshot.exchangeRate}
      />
    );
    expect(html).toContain('Volver al catálogo');
    expect(html).toContain('href="/catalogo/"');
    expect(html).not.toContain('USD');
  });
});
