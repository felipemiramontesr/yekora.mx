import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getMessages } from '@/app/i18n';
import { BrandBanner } from './BrandBanner';

describe('BrandBanner', () => {
  it('states the philosophy and its three pillars', () => {
    const html = renderToStaticMarkup(
      <BrandBanner messages={getMessages('es-MX').brandBanner} />
    );
    expect(html).toContain('id="filosofia"');
    expect(html).toContain('Compra mejor, no más');
    for (const pillar of ['Selección', 'Confianza', 'Accesibilidad']) {
      expect(html).toContain(pillar);
    }
  });

  it('translates to English', () => {
    const html = renderToStaticMarkup(
      <BrandBanner messages={getMessages('en').brandBanner} />
    );
    expect(html).toContain('Buy better, not more');
  });
});
