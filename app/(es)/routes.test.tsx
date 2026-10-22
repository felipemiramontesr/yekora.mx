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
import Cart, { metadata as CartMeta } from './carrito/page';
import Checkout, { metadata as CheckoutMeta } from './checkout/page';
import Success, { metadata as SuccessMeta } from './checkout/exito/page';
import Cancel, { metadata as CancelMeta } from './checkout/cancelado/page';
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

  it('cart is at /carrito/, never indexed, and prerenders the empty pack', () => {
    expect(CartMeta.alternates?.canonical).toBe('/carrito/');
    expect(CartMeta.alternates?.languages).toMatchObject({ en: '/en/cart/' });
    expect(CartMeta.robots).toEqual({ index: false, follow: false });
    const html = renderToStaticMarkup(<Cart />);
    expect(html).toContain('Tu mochila');
    expect(html).toContain('Tu mochila está vacía');
  });

  it('checkout is at /checkout/, never indexed, and prerenders the empty state', () => {
    expect(CheckoutMeta.alternates?.canonical).toBe('/checkout/');
    expect(CheckoutMeta.alternates?.languages).toMatchObject({
      en: '/en/checkout/',
    });
    expect(CheckoutMeta.title).toBe('Finalizar compra | YĒKORA');
    expect(CheckoutMeta.robots).toEqual({ index: false, follow: false });
    const html = renderToStaticMarkup(<Checkout />);
    expect(html).toContain('<h1');
    expect(html).toContain('Tu mochila está vacía');
  });

  it.each([
    ['/checkout/exito/', SuccessMeta, Success, 'Tu pedido'],
    ['/checkout/cancelado/', CancelMeta, Cancel, 'No se completó el pago'],
  ])(
    'return page %s is never indexed and prerenders while it reads the order',
    (path, meta, Page, title) => {
      expect(meta.alternates?.canonical).toBe(path);
      expect(meta.robots).toEqual({ index: false, follow: false });
      const html = renderToStaticMarkup(<Page />);
      expect(html).toContain(title);
      expect(html).toContain('Consultando tu pedido');
    }
  );

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
