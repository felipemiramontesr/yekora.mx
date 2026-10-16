import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LegalView } from './LegalView';

describe('LegalView', () => {
  it('privacy notice: LFPDPPP 2025 sections, pending data flagged, no abrogated authority', () => {
    const html = renderToStaticMarkup(
      <LegalView locale="es-MX" document="privacy" />
    );
    expect(html).toContain('Aviso de privacidad y manejo de datos personales');
    expect(html).toContain('20 de marzo de 2025');
    expect(html).toContain('Derechos ARCO');
    expect(html).toContain('[Pendiente: correo de contacto de privacidad]');
    expect(html).toContain('una sola cookie técnica');
    expect(html).not.toContain('INAI');
    expect(html).not.toContain('<table');
  });

  it('cookie policy lists exactly the one technical cookie the site sets', () => {
    const html = renderToStaticMarkup(
      <LegalView locale="es-MX" document="cookies" />
    );
    expect(html).toContain('<table');
    expect(html).toContain('yekora_cookie_consent');
    expect(html).not.toContain('yekora_locale');
    expect(html.match(/<tr /g)).toHaveLength(2);
  });

  it('terms ground the site in Mexican consumer law, in English too', () => {
    const spanish = renderToStaticMarkup(
      <LegalView locale="es-MX" document="terms" />
    );
    expect(spanish).toContain('moneda nacional (MXN)');
    expect(spanish).toContain('NMX-COE-001-SCFI-2018');
    const english = renderToStaticMarkup(
      <LegalView locale="en" document="terms" />
    );
    expect(english).toContain('Site use policy');
  });
});
