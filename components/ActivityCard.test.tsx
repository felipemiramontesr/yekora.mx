import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getMessages } from '@/app/i18n';
import { ActivityCard } from './ActivityCard';

describe('ActivityCard', () => {
  it('renders the discipline as an anchor target with its level and description', () => {
    const { activities, disciplines } = getMessages('es-MX');
    const html = renderToStaticMarkup(
      <ActivityCard
        discipline="escalada"
        name={disciplines.escalada}
        levelLabel={activities.levelLabel}
        activity={activities.items.escalada}
      />
    );
    expect(html).toContain('id="escalada"');
    expect(html).toContain('Escalada');
    expect(html).toContain('Nivel:');
    expect(html).toContain('Todos los niveles, con formación');
    expect(html).toContain('para qué no');
  });

  it('shows the discipline pictogram as decoration before the heading', () => {
    const { activities, disciplines } = getMessages('en');
    const html = renderToStaticMarkup(
      <ActivityCard
        discipline="canonismo"
        name={disciplines.canonismo}
        levelLabel={activities.levelLabel}
        activity={activities.items.canonismo}
      />
    );
    expect(html).toMatch(
      /<svg[^>]*aria-hidden="true"[^>]*data-discipline="canonismo".*<h3/
    );
  });
});
