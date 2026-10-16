import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PrivacyPage, { generateMetadata } from './page';

const params = (locale: string) => ({ params: Promise.resolve({ locale }) });

describe('PrivacyPage', () => {
  it('covers the LFPDPPP 2025 sections and flags pending data', async () => {
    const html = renderToStaticMarkup(await PrivacyPage(params('es-MX')));
    expect(html).toContain('Aviso de privacidad y manejo de datos personales');
    expect(html).toContain('20 de marzo de 2025');
    expect(html).toContain('Derechos ARCO');
    expect(html).toContain('[Pendiente: correo de contacto de privacidad]');
    expect(html).toContain('Versión base en revisión jurídica');
  });

  it('does not name an abrogated authority', async () => {
    const html = renderToStaticMarkup(await PrivacyPage(params('es-MX')));
    expect(html).not.toContain('INAI');
  });

  it('is translated to English and canonical in its own language', async () => {
    const html = renderToStaticMarkup(await PrivacyPage(params('en')));
    expect(html).toContain('ARCO rights');
    const metadata = await generateMetadata(params('en'));
    expect(metadata.title).toBe('Privacy notice | YĒKORA');
    expect(metadata.alternates?.canonical).toBe('/en/privacidad');
  });
});
