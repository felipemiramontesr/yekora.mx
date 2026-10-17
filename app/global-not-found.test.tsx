import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/globals.css', () => ({}));
vi.mock('next/font/google', () => ({
  Inter: () => ({ variable: 'inter-variable' }),
}));
vi.mock('next/navigation', () => ({ usePathname: () => null }));

import GlobalNotFound, { metadata } from './global-not-found';

describe('global-not-found', () => {
  const html = renderToStaticMarkup(<GlobalNotFound />);

  it('is a whole Spanish document with the site header and footer', () => {
    expect(html).toContain('<html lang="es-MX"');
    expect(html).toContain('<header');
    expect(html).toContain('<footer');
  });

  it('shows the isotype and says the trail was lost, in Spanish then English', () => {
    expect(html).toContain('/brand/elements/YEKORA_01_ISOTIPO_MARFIL.svg');
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*>Ruta no encontrada<\/h1>/);
    expect(html).toMatch(
      /<div lang="en">[\s\S]*<h2[^>]*>Trail not found<\/h2>/
    );
    expect(html.indexOf('Ruta no encontrada')).toBeLessThan(
      html.indexOf('Trail not found')
    );
  });

  it('leads back to each home page with a decorative compass', () => {
    const back =
      /<a href="\/"[^>]*><svg[^>]*>[\s\S]*?<\/svg>Volver[^<]*<\/a>/.exec(
        html
      )?.[0];
    expect(back).toContain('lucide-compass');
    expect(back).toContain('aria-hidden="true"');
    expect(back).toContain('Volver al sendero principal');
    expect(html).toMatch(
      /<a href="\/en\/"[^>]*>[\s\S]*?Back to the home trail<\/a>/
    );
  });

  it('asks search engines not to index the error page', () => {
    expect(metadata).toEqual({
      title: 'Página no encontrada | YĒKORA',
      robots: { index: false, follow: true },
    });
  });
});
