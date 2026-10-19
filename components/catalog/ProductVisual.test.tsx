import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProductVisual } from './ProductVisual';

describe('ProductVisual', () => {
  it('shows the photo with its alt text, lazily by default', () => {
    const html = renderToStaticMarkup(
      <ProductVisual
        image={{ path: '/images/products/arnes.webp', alt: 'Alpine harness' }}
        discipline="escalada"
      />
    );
    expect(html).toContain('src="/images/products/arnes.webp"');
    expect(html).toContain('alt="Alpine harness"');
    expect(html).toContain('loading="lazy"');
  });

  it('loads the first photo of a product page eagerly', () => {
    const html = renderToStaticMarkup(
      <ProductVisual
        image={{ path: '/images/products/arnes.webp', alt: '' }}
        discipline="escalada"
        loading="eager"
      />
    );
    expect(html).toContain('loading="eager"');
  });

  it('falls back to the discipline pictogram, hidden from assistive tech', () => {
    const html = renderToStaticMarkup(
      <ProductVisual image={null} discipline="canonismo" />
    );
    expect(html).toContain('data-discipline="canonismo"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('<img');
  });

  it('draws a generic mountain for a discipline added later in the database', () => {
    const html = renderToStaticMarkup(
      <ProductVisual image={null} discipline="via-ferrata" />
    );
    expect(html).toContain('lucide-mountain');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('data-discipline');
  });
});
