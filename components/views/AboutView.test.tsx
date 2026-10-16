import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AboutView } from './AboutView';

describe('AboutView', () => {
  it('tells the brand story from the ADN in Spanish', () => {
    const html = renderToStaticMarkup(<AboutView locale="es-MX" />);
    expect(html).toContain('<h1');
    for (const heading of [
      'Quiénes somos',
      'Nuestro propósito',
      'Misión',
      'Visión',
    ]) {
      expect(html).toContain(heading);
    }
    expect(html).toContain('Impulso a lo mexicano');
    expect(html).toContain('compre mejor');
  });

  it('is translated to English', () => {
    const html = renderToStaticMarkup(<AboutView locale="en" />);
    expect(html).toContain('About us');
    expect(html).toContain('buy better');
  });
});
