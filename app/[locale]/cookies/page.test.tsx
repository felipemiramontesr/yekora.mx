import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import CookiesPage, { generateMetadata } from './page';

const params = (locale: string) => ({ params: Promise.resolve({ locale }) });

describe('CookiesPage', () => {
  it('lists exactly the two technical cookies the site sets', async () => {
    const html = renderToStaticMarkup(await CookiesPage(params('es-MX')));
    expect(html).toContain('Política de cookies');
    expect(html).toContain('<table');
    expect(html).toContain('yekora_locale');
    expect(html).toContain('yekora_cookie_consent');
    expect(html.match(/<tr /g)).toHaveLength(3);
    expect(html).toContain('No usamos cookies de analítica');
  });

  it('is translated to English and canonical in its own language', async () => {
    const html = renderToStaticMarkup(await CookiesPage(params('en')));
    expect(html).toContain('Cookie policy');
    const metadata = await generateMetadata(params('es-MX'));
    expect(metadata.title).toBe('Política de cookies | YĒKORA');
    expect(metadata.alternates?.canonical).toBe('/es-MX/cookies');
  });
});
