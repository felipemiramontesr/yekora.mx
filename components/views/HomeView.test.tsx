import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HomeView } from './HomeView';

describe('HomeView', () => {
  it('leads with the brand promise and links inside the current language', () => {
    const html = renderToStaticMarkup(<HomeView locale="es-MX" />);
    expect(html).toContain('<h1');
    expect(html).toContain('Equipo adecuado. Información clara.');
    expect(html).toContain('href="/#disciplinas"');
    expect(html).toContain('href="/nosotros/"');
  });

  it('lists the five disciplines as anchor targets', () => {
    const html = renderToStaticMarkup(<HomeView locale="es-MX" />);
    for (const id of [
      'disciplinas',
      'senderismo',
      'montana',
      'escalada',
      'canonismo',
      'trail-running',
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it('links the English pages and keeps the Mexican section free of brand names', () => {
    const html = renderToStaticMarkup(<HomeView locale="en" />);
    expect(html).toContain('href="/en/#disciplinas"');
    expect(html).toContain('href="/en/about/"');
    expect(html).toContain('id="filosofia"');
    expect(html).toContain('Soon you will meet the brands we work with here.');
  });
});
