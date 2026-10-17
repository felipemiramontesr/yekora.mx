import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getMessages } from '@/app/i18n';
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

  it.each(['es-MX', 'en'] as const)(
    'gives each brand value its own decorative icon (%s)',
    (locale) => {
      const html = renderToStaticMarkup(<AboutView locale={locale} />);
      const terms = html.match(/<dt[^>]*>.*?<\/dt>/g) ?? [];
      expect(terms).toHaveLength(getMessages(locale).about.values.length);
      const icons = terms.map((term) => /lucide-([a-z-]+)/.exec(term)?.[1]);
      expect(icons).toEqual([
        'shield-check',
        'award',
        'trees',
        'sparkles',
        'users',
      ]);
      for (const term of terms) expect(term).toContain('aria-hidden="true"');
    }
  );

  it('is translated to English', () => {
    const html = renderToStaticMarkup(<AboutView locale="en" />);
    expect(html).toContain('About us');
    expect(html).toContain('buy better');
  });
});
