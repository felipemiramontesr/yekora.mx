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
    expect(html).toContain('src="/brand/YEKORA_isotipo_vectorial.svg"');
    expect(html).toContain('alt="YĒKORA — Tienda Outdoor"');
    expect(html).toContain('href="/en" aria-label="YĒKORA, go to home"');
  });

  it('anchors every discipline inside the current language', () => {
    for (const anchor of [
      'senderismo',
      'montana',
      'escalada',
      'canonismo',
      'trail-running',
    ]) {
      expect(html).toContain(`href="/en#${anchor}"`);
    }
    expect(html).toContain('Mountaineering');
    expect(html).toContain('href="/en/nosotros"');
  });

  it('shows the catalog as coming soon, never as a link', () => {
    expect(html).toContain('Coming soon');
    expect(html).not.toContain('/catalogo');
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
    expect(spanish).toContain('href="/es-MX#canonismo"');
    expect(spanish).toContain('Cañonismo');
    expect(spanish).toContain('Próximamente');
  });
});
