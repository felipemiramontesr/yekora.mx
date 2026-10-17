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

  it('draws the hero backdrop and button icons as hidden decoration', () => {
    const html = renderToStaticMarkup(<HomeView locale="es-MX" />);
    const hero =
      /<section data-hero="true"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
    // Backdrop drawing, overlay and both button icons are all decorative.
    expect(hero.match(/aria-hidden="true"/g)).toHaveLength(4);
    expect(hero).toContain('from-petroleo/95');
    expect(hero).toContain('to-petroleo/80');
    expect(hero).toContain('lucide-compass');
    expect(hero).toContain('lucide-arrow-right');
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
