import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/globals.css', () => ({}));
vi.mock('next/font/google', () => ({
  Inter: () => ({ variable: 'inter-variable' }),
}));
vi.mock('next/navigation', () => ({ usePathname: () => null }));
// The real snapshot depends on the last local build; pages here render the empty catalog.
vi.mock('@/lib/catalog/snapshot', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/catalog/snapshot')>();
  return { ...actual, loadSnapshot: () => actual.EMPTY_SNAPSHOT };
});

import Layout, { metadata as layoutMeta } from './layout';
import Catalog, { metadata as CatalogMeta } from './catalogo/page';
import * as ProductPage from './catalogo/[slug]/page';
import Home, { metadata as HomeMeta } from './page';
import About, { metadata as AboutMeta } from './nosotros/page';
import Privacy, { metadata as PrivacyMeta } from './privacidad/page';
import Cookies, { metadata as CookiesMeta } from './cookies/page';
import Terms, { metadata as TermsMeta } from './terminos/page';
import Shipping, {
  metadata as ShippingMeta,
} from './envios-y-devoluciones/page';
import Offline, { metadata as OfflineMeta } from './offline/page';

describe('es-MX routes', () => {
  it('root layout declares lang="es-MX" and the site metadata', () => {
    const html = renderToStaticMarkup(
      <Layout>
        <p>child</p>
      </Layout>
    );
    expect(html).toContain('<html lang="es-MX"');
    expect(layoutMeta.metadataBase?.toString()).toBe('https://yekora.mx/');
  });

  it('home is canonical at /', () => {
    expect(HomeMeta.alternates?.canonical).toBe('/');
    expect(renderToStaticMarkup(<Home />)).toContain('<h1');
  });

  it('about is canonical at /nosotros/', () => {
    expect(AboutMeta.alternates?.canonical).toBe('/nosotros/');
    expect(renderToStaticMarkup(<About />)).toContain('<h1');
  });

  it('privacy is canonical at /privacidad/', () => {
    expect(PrivacyMeta.alternates?.canonical).toBe('/privacidad/');
    expect(renderToStaticMarkup(<Privacy />)).toContain('<h1');
  });

  it('cookies is canonical at /cookies/', () => {
    expect(CookiesMeta.alternates?.canonical).toBe('/cookies/');
    expect(renderToStaticMarkup(<Cookies />)).toContain('<h1');
  });

  it('terms is canonical at /terminos/', () => {
    expect(TermsMeta.alternates?.canonical).toBe('/terminos/');
    expect(renderToStaticMarkup(<Terms />)).toContain('<h1');
  });

  it('shipping and returns is canonical at /envios-y-devoluciones/', () => {
    expect(ShippingMeta.alternates?.canonical).toBe('/envios-y-devoluciones/');
    expect(ShippingMeta.alternates?.languages).toMatchObject({
      en: '/en/shipping-and-returns/',
    });
    expect(renderToStaticMarkup(<Shipping />)).toContain('<h1');
  });

  it('offline is canonical at /offline/ and never indexed', () => {
    expect(OfflineMeta.alternates?.canonical).toBe('/offline/');
    expect(OfflineMeta.robots).toEqual({ index: false, follow: false });
    expect(renderToStaticMarkup(<Offline />)).toContain('<h1');
  });

  it('catalog is canonical at /catalogo/ and shows «Próximamente» while empty', () => {
    expect(CatalogMeta.alternates?.canonical).toBe('/catalogo/');
    expect(CatalogMeta.alternates?.languages).toMatchObject({
      en: '/en/catalog/',
    });
    expect(renderToStaticMarkup(<Catalog />)).toContain('Próximamente');
  });

  it('product pages exist only for the snapshot slugs (static export)', () => {
    expect(ProductPage.dynamicParams).toBe(false);
    expect(ProductPage.generateStaticParams()).toEqual([{ slug: '__none__' }]);
    expect(typeof ProductPage.default).toBe('function');
    expect(typeof ProductPage.generateMetadata).toBe('function');
  });

  it('home shows the brand promise', () => {
    expect(renderToStaticMarkup(<Home />)).toContain('Equipo adecuado');
  });
});
