import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import TermsPage, { generateMetadata } from './page';

const params = (locale: string) => ({ params: Promise.resolve({ locale }) });

describe('TermsPage', () => {
  it('grounds the terms in Mexican consumer law and states prices in MXN', async () => {
    const html = renderToStaticMarkup(await TermsPage(params('es-MX')));
    expect(html).toContain('Términos y condiciones de uso');
    expect(html).toContain('Política de uso del sitio');
    expect(html).toContain('moneda nacional (MXN)');
    expect(html).toContain('NMX-COE-001-SCFI-2018');
    expect(html).toContain('PROFECO');
  });

  it('is translated to English and canonical in its own language', async () => {
    const html = renderToStaticMarkup(await TermsPage(params('en')));
    expect(html).toContain('Site use policy');
    const metadata = await generateMetadata(params('en'));
    expect(metadata.title).toBe('Terms and conditions | YĒKORA');
    expect(metadata.alternates?.canonical).toBe('/en/terminos');
  });
});
