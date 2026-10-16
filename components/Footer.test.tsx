import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getMessages } from '@/app/i18n';
import { Footer } from './Footer';

describe('Footer', () => {
  const html = renderToStaticMarkup(
    <Footer locale="es-MX" messages={getMessages('es-MX')} />
  );

  it('shows the client logo and the brand promise', () => {
    expect(html).toContain(
      'src="/brand/elements/YEKORA_01_ISOTIPO_MARFIL.svg"'
    );
    expect(html).toContain('Equipo adecuado. Información clara.');
  });

  it('links the legal pages in the current language', () => {
    expect(html).toContain('href="/privacidad/"');
    expect(html).toContain('href="/cookies/"');
    expect(html).toContain('href="/terminos/"');
    expect(html).toContain('Aviso de privacidad');
  });

  it('anchors disciplines and credits Mexican makers without naming brands', () => {
    expect(html).toContain('href="/#trail-running"');
    expect(html).toContain('Impulsamos a marcas y fabricantes mexicanos');
    expect(html).toContain(`© ${new Date().getFullYear()} YĒKORA.`);
  });
});
