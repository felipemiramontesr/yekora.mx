import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import fixture from '@/e2e/fixtures/catalog.json';
import {
  EMPTY_SNAPSHOT,
  parseSnapshot,
  PLACEHOLDER_SLUG,
  type CatalogSnapshot,
} from '@/lib/catalog/snapshot';

const current = vi.hoisted(() => ({ snapshot: null as unknown }));
vi.mock('@/lib/catalog/snapshot', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/catalog/snapshot')>()),
  loadSnapshot: () => current.snapshot,
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const { productRoute } = await import('./productRoute');

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });
function use(snapshot: CatalogSnapshot) {
  current.snapshot = snapshot;
}

describe('productRoute', () => {
  it('prerenders one page per product of the snapshot', () => {
    use(parseSnapshot(fixture));
    expect(productRoute('es-MX').generateStaticParams()).toHaveLength(3);
  });

  it('prerenders only the placeholder for an empty catalog', () => {
    use(EMPTY_SNAPSHOT);
    expect(productRoute('en').generateStaticParams()).toEqual([
      { slug: PLACEHOLDER_SLUG },
    ]);
  });

  it('titles a product page with the product and its hreflang pair', async () => {
    use(parseSnapshot(fixture));
    const metadata = await productRoute('en').generateMetadata(
      params('e2e-arnes-alpino')
    );
    expect(metadata.title).toBe('Alpine harness (E2E test) | YĒKORA');
    expect(metadata.alternates?.canonical).toBe(
      '/en/catalog/e2e-arnes-alpino/'
    );
  });

  it('marks the placeholder noindex', async () => {
    use(EMPTY_SNAPSHOT);
    expect(
      await productRoute('es-MX').generateMetadata(params(PLACEHOLDER_SLUG))
    ).toEqual({ robots: { index: false, follow: false } });
  });

  it('renders the product page', async () => {
    use(parseSnapshot(fixture));
    const page = await productRoute('es-MX').Page(params('e2e-tenis-trail'));
    const html = renderToStaticMarkup(page);
    expect(html).toContain('Tenis de trail (prueba E2E)');
    expect(html).toContain('Agotado');
  });

  it('answers 404 for the placeholder', async () => {
    use(EMPTY_SNAPSHOT);
    await expect(
      productRoute('en').Page(params(PLACEHOLDER_SLUG))
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
