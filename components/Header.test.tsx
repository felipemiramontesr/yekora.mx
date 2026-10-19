import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { getMessages } from '@/app/i18n';
import { Header } from './Header';

vi.mock('next/navigation', () => ({ usePathname: () => '/en' }));

describe('Header', () => {
  const html = renderToStaticMarkup(
    <Header locale="en" messages={getMessages('en')} />
  );

  it('uses the client isotype and links home in the current language', () => {
    expect(html).toContain(
      'src="/brand/elements/YEKORA_01_ISOTIPO_MARFIL.svg"'
    );
    expect(html).toContain('src="/brand/elements/YEKORA_02_NOMBRE_MARFIL.svg"');
    expect(html).toContain('href="/en/" aria-label="YĒKORA, go to home"');
  });

  it('anchors every discipline inside the current language', () => {
    for (const anchor of [
      'senderismo',
      'montana',
      'escalada',
      'canonismo',
      'trail-running',
    ]) {
      expect(html).toContain(`href="/en/#${anchor}"`);
    }
    expect(html).toContain('Mountaineering');
    expect(html).toContain('href="/en/about/"');
  });

  it('links the catalog in the current language (FC 008)', () => {
    expect(html).toContain('href="/en/catalog/"');
    expect(html).not.toContain('/catalogo');
    expect(html).not.toContain('Coming soon');
  });

  it('renders the mobile menu without client JavaScript', () => {
    expect(html).toContain('<details');
    expect(html).toContain('<summary');
    expect(html).toContain('Menu');
  });

  it('renders the Spanish copy for es-MX', () => {
    const spanish = renderToStaticMarkup(
      <Header locale="es-MX" messages={getMessages('es-MX')} />
    );
    expect(spanish).toContain('href="/#canonismo"');
    expect(spanish).toContain('Cañonismo');
    expect(spanish).toContain('href="/catalogo/"');
  });
});
