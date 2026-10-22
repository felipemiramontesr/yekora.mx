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
import Catalog, { metadata as CatalogMeta } from './catalog/page';
import Cart, { metadata as CartMeta } from './cart/page';
import Checkout, { metadata as CheckoutMeta } from './checkout/page';
import Success, { metadata as SuccessMeta } from './checkout/success/page';
import Cancel, { metadata as CancelMeta } from './checkout/cancel/page';
import * as ProductPage from './catalog/[slug]/page';
import Home, { metadata as HomeMeta } from './page';
import About, { metadata as AboutMeta } from './about/page';
import Privacy, { metadata as PrivacyMeta } from './privacy/page';
import Cookies, { metadata as CookiesMeta } from './cookies/page';
import Terms, { metadata as TermsMeta } from './terms/page';
import Shipping, {
  metadata as ShippingMeta,
} from './shipping-and-returns/page';
import Offline, { metadata as OfflineMeta } from './offline/page';

describe('en routes', () => {
  it('root layout declares lang="en" and the site metadata', () => {
    const html = renderToStaticMarkup(
      <Layout>
        <p>child</p>
      </Layout>
    );
    expect(html).toContain('<html lang="en"');
    expect(layoutMeta.metadataBase?.toString()).toBe('https://yekora.mx/');
  });

  it('home is canonical at /en/', () => {
    expect(HomeMeta.alternates?.canonical).toBe('/en/');
    expect(renderToStaticMarkup(<Home />)).toContain('<h1');
  });

  it('about is canonical at /en/about/', () => {
    expect(AboutMeta.alternates?.canonical).toBe('/en/about/');
    expect(renderToStaticMarkup(<About />)).toContain('<h1');
  });

  it('privacy is canonical at /en/privacy/', () => {
    expect(PrivacyMeta.alternates?.canonical).toBe('/en/privacy/');
    expect(renderToStaticMarkup(<Privacy />)).toContain('<h1');
  });

  it('cookies is canonical at /en/cookies/', () => {
    expect(CookiesMeta.alternates?.canonical).toBe('/en/cookies/');
    expect(renderToStaticMarkup(<Cookies />)).toContain('<h1');
  });

  it('terms is canonical at /en/terms/', () => {
    expect(TermsMeta.alternates?.canonical).toBe('/en/terms/');
    expect(renderToStaticMarkup(<Terms />)).toContain('<h1');
  });

  it('catalog is canonical at /en/catalog/ and shows «Coming soon» while empty', () => {
    expect(CatalogMeta.alternates?.canonical).toBe('/en/catalog/');
    expect(CatalogMeta.title).toBe('Catalog | YĒKORA');
    expect(renderToStaticMarkup(<Catalog />)).toContain('Coming soon');
  });

  it('cart is at /en/cart/, never indexed, and prerenders the empty pack', () => {
    expect(CartMeta.alternates?.canonical).toBe('/en/cart/');
    expect(CartMeta.title).toBe('Your pack | YĒKORA');
    expect(CartMeta.robots).toEqual({ index: false, follow: false });
    expect(renderToStaticMarkup(<Cart />)).toContain('Your pack is empty');
  });

  it('checkout is at /en/checkout/, never indexed, and prerenders the empty state', () => {
    expect(CheckoutMeta.alternates?.canonical).toBe('/en/checkout/');
    expect(CheckoutMeta.title).toBe('Checkout | YĒKORA');
    expect(CheckoutMeta.robots).toEqual({ index: false, follow: false });
    expect(renderToStaticMarkup(<Checkout />)).toContain('Your pack is empty');
  });

  it.each([
    ['/en/checkout/success/', SuccessMeta, Success, 'Your order'],
    ['/en/checkout/cancel/', CancelMeta, Cancel, 'Payment not completed'],
  ])(
    'return page %s is never indexed and prerenders while it reads the order',
    (path, meta, Page, title) => {
      expect(meta.alternates?.canonical).toBe(path);
      expect(meta.title).toBe(`${title} | YĒKORA`);
      expect(meta.robots).toEqual({ index: false, follow: false });
      const html = renderToStaticMarkup(<Page />);
      expect(html).toContain(title);
      expect(html).toContain('Checking your order');
    }
  );

  it('product pages exist only for the snapshot slugs (static export)', () => {
    expect(ProductPage.dynamicParams).toBe(false);
    expect(ProductPage.generateStaticParams()).toEqual([{ slug: '__none__' }]);
    expect(typeof ProductPage.default).toBe('function');
    expect(typeof ProductPage.generateMetadata).toBe('function');
  });

  it('home shows the brand promise', () => {
    expect(renderToStaticMarkup(<Home />)).toContain('The right gear');
  });

  it('shipping and returns is canonical at /en/shipping-and-returns/', () => {
    expect(ShippingMeta.alternates?.canonical).toBe(
      '/en/shipping-and-returns/'
    );
    expect(ShippingMeta.title).toBe('Shipping and returns | YĒKORA');
    expect(renderToStaticMarkup(<Shipping />)).toContain('<h1');
  });

  it('offline is canonical at /en/offline/ and never indexed', () => {
    expect(OfflineMeta.alternates?.canonical).toBe('/en/offline/');
    expect(OfflineMeta.robots).toEqual({ index: false, follow: false });
    expect(renderToStaticMarkup(<Offline />)).toContain('<h1');
  });
});
