import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/globals.css', () => ({}));
vi.mock('next/font/google', () => ({
  Inter: () => ({ variable: 'inter-variable' }),
}));
vi.mock('next/navigation', () => ({ usePathname: () => null }));

import Layout, { metadata as layoutMeta } from './layout';
import Home, { metadata as HomeMeta } from './page';
import About, { metadata as AboutMeta } from './nosotros/page';
import Privacy, { metadata as PrivacyMeta } from './privacidad/page';
import Cookies, { metadata as CookiesMeta } from './cookies/page';
import Terms, { metadata as TermsMeta } from './terminos/page';

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

  it('home shows the brand promise', () => {
    expect(renderToStaticMarkup(<Home />)).toContain('Equipo adecuado');
  });
});
