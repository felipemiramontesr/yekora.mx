import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AboutPage, { generateMetadata } from './page';

const params = (locale: string) => ({ params: Promise.resolve({ locale }) });

describe('AboutPage', () => {
  it('tells the brand story from the ADN in Spanish', async () => {
    const html = renderToStaticMarkup(await AboutPage(params('es-MX')));
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
    expect(html).toContain('Equipo adecuado. Información clara.');
    expect(html).toContain('compre mejor');
  });

  it('is translated to English', async () => {
    const html = renderToStaticMarkup(await AboutPage(params('en')));
    expect(html).toContain('About us');
    expect(html).toContain('buy better');
  });

  it('is canonical in its own language with an hreflang pair', async () => {
    const metadata = await generateMetadata(params('en'));
    expect(metadata.title).toBe('About us | YĒKORA');
    expect(metadata.alternates?.canonical).toBe('/en/nosotros');
    expect(metadata.alternates?.languages).toEqual({
      'es-MX': '/es-MX/nosotros',
      en: '/en/nosotros',
      'x-default': '/es-MX/nosotros',
    });
  });
});
