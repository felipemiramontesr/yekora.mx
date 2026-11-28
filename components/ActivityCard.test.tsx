import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getMessages } from '@/app/i18n';
import { ActivityCard } from './ActivityCard';

describe('ActivityCard', () => {
  it('renders the discipline as an anchor target with its description, and no level (FC 048)', () => {
    const { activities, disciplines } = getMessages('es-MX');
    const html = renderToStaticMarkup(
      <ActivityCard
        discipline="escalada"
        name={disciplines.escalada}
        activity={activities.items.escalada}
        href="/catalogo/?disciplina=escalada"
      />
    );
    expect(html).toContain('id="escalada"');
    // FC 078 T2.1: the whole card leads to the catalog of the discipline, read with its own text.
    expect(html).toMatch(/^<a [^>]*href="\/catalogo\/\?disciplina=escalada"/);
    expect(html).not.toContain('aria-labelledby');
    expect(html).toContain('Escalada');
    expect(html).not.toContain('Nivel');
    expect(html).toContain('para qué no');
  });

  it('shows the discipline pictogram as decoration before the heading', () => {
    const { activities, disciplines } = getMessages('en');
    const html = renderToStaticMarkup(
      <ActivityCard
        discipline="canonismo"
        name={disciplines.canonismo}
        activity={activities.items.canonismo}
        href="/en/catalog/?disciplina=canonismo"
      />
    );
    expect(html).toMatch(
      /<svg[^>]*aria-hidden="true"[^>]*data-discipline="canonismo".*<h3/
    );
  });
});
