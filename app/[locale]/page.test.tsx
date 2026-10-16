import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import HomePage, { generateMetadata } from './page';

async function render(locale: string): Promise<string> {
  return renderToStaticMarkup(
    await HomePage({ params: Promise.resolve({ locale }) })
  );
}

describe('HomePage', () => {
  it('is canonical at the language root', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ locale: 'es-MX' }),
    });
    expect(metadata.title).toBe('YĒKORA | Tienda Outdoor');
    expect(metadata.alternates?.canonical).toBe('/es-MX');
    expect(metadata.alternates?.languages).toEqual({
      'es-MX': '/es-MX',
      en: '/en',
      'x-default': '/es-MX',
    });
  });

  it('leads with the brand promise and links inside the current language', async () => {
    const html = await render('es-MX');
    expect(html).toContain('<h1');
    expect(html).toContain('Equipo adecuado. Información clara.');
    expect(html).toContain('href="/es-MX#disciplinas"');
    expect(html).toContain('href="/es-MX/nosotros"');
    expect(html).toContain('src="/brand/YEKORA_logo_vectorial_marfil.svg"');
  });

  it('lists the five disciplines as anchor targets', async () => {
    const html = await render('es-MX');
    expect(html).toContain('id="disciplinas"');
    for (const discipline of [
      'senderismo',
      'montana',
      'escalada',
      'canonismo',
      'trail-running',
    ]) {
      expect(html).toContain(`id="${discipline}"`);
    }
  });

  it('includes the philosophy and the Mexican talent sections without naming brands', async () => {
    const html = await render('en');
    expect(html).toContain('id="filosofia"');
    expect(html).toContain('Buy better, not more');
    expect(html).toContain('id="marcas-mexicanas"');
    expect(html).toContain('Soon you will meet the brands we work with here.');
  });
});
