import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/globals.css', () => ({}));
vi.mock('next/font/google', () => ({
  Inter: () => ({ variable: 'inter-variable' }),
}));
vi.mock('next/navigation', () => ({ usePathname: () => null }));

import Layout, { metadata as layoutMeta } from './layout';
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
