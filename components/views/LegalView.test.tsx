import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LegalView } from './LegalView';

describe('LegalView', () => {
  it('privacy notice: LFPDPPP 2025 sections, the real controller, no abrogated authority', () => {
    const html = renderToStaticMarkup(
      <LegalView locale="es-MX" document="privacy" />
    );
    expect(html).toContain('Aviso de privacidad y manejo de datos personales');
    expect(html).toContain('20 de marzo de 2025');
    expect(html).toContain('Derechos ARCO');
    expect(html).toContain('es Ana Karen Flores Baca, con domicilio en');
    expect(html).toContain('C.P. 98612, Guadalupe, Zacatecas');
    expect(html).toContain('enviando una solicitud a contacto@yekora.mx');
    expect(html).toContain('dos cookies técnicas propias');
    expect(html).not.toContain('INAI');
    expect(html).not.toContain('<table');
  });

  it('cookie policy lists exactly the technical cookies the site sets', () => {
    const html = renderToStaticMarkup(
      <LegalView locale="es-MX" document="cookies" />
    );
    expect(html).toContain('<table');
    expect(html).toContain('yekora_cookie_consent');
    expect(html).toContain('yekora_location_consent');
    expect(html).not.toContain('yekora_locale');
    expect(html.match(/<tr /g)).toHaveLength(3);
  });

  it('cookie, privacy and terms name the geocoders and the session storage of the postal code (FC 055 T2.6, T2.8)', () => {
    for (const document of ['cookies', 'privacy', 'terms'] as const) {
      for (const locale of ['es-MX', 'en'] as const) {
        const html = renderToStaticMarkup(
          <LegalView locale={locale} document={document} />
        );
        // FC 055 T2.8: the three documents name both providers.
        expect(html).toContain('BigDataCloud');
        expect(html).toContain('Nominatim');
        expect(html.toLowerCase()).toMatch(/ubicaci|location/);
        if (document === 'cookies') {
          expect(html).toContain('yekora_delivery_place_v1');
        }
      }
    }
  });

  it('privacy notice and terms say one card is kept, that Stripe holds it, and that Link and the wallets are independent, in both languages (FC 057 T2.4)', () => {
    const expected = {
      'es-MX': [
        'como máximo una tarjeta',
        'Stripe Link',
        'Apple Pay',
        'Google Pay',
        'no modifica ni elimina',
        'Edit wallet',
      ],
      en: [
        'at most one card',
        'Stripe Link',
        'Apple Pay',
        'Google Pay',
        'does not modify or delete',
        'Edit wallet',
      ],
    } as const;
    for (const locale of ['es-MX', 'en'] as const) {
      for (const document of ['privacy', 'terms'] as const) {
        const html = renderToStaticMarkup(
          <LegalView locale={locale} document={document} />
        );
        for (const phrase of expected[locale]) {
          expect(html, `${locale} ${document}`).toContain(phrase);
        }
      }
    }
  });

  it('terms ground the site in Mexican consumer law, in English too', () => {
    const spanish = renderToStaticMarkup(
      <LegalView locale="es-MX" document="terms" />
    );
    expect(spanish).toContain('moneda nacional (MXN)');
    expect(spanish).toContain('NMX-COE-001-SCFI-2018');
    expect(spanish).toContain('operado por Ana Karen Flores Baca');
    expect(spanish).toContain(
      'tribunales competentes de Guadalupe, Zacatecas, México'
    );
    const english = renderToStaticMarkup(
      <LegalView locale="en" document="terms" />
    );
    expect(english).toContain('Site use policy');
  });
});
