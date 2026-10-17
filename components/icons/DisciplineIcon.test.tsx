import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { disciplines } from '@/app/i18n';
import { DisciplineIcon } from './DisciplineIcon';

describe('DisciplineIcon', () => {
  it.each(disciplines)(
    'draws %s as a decorative line pictogram on the 24 px grid',
    (discipline) => {
      const html = renderToStaticMarkup(
        <DisciplineIcon discipline={discipline} />
      );
      expect(html).toContain('viewBox="0 0 24 24"');
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('focusable="false"');
      expect(html).toContain('stroke="currentColor"');
      expect(html).toContain('width="32"');
      expect(html).toMatch(/<(path|circle) /);
    }
  );

  it.each(disciplines)(
    'keeps %s free of scripts, handlers and URLs',
    (discipline) => {
      const html = renderToStaticMarkup(
        <DisciplineIcon discipline={discipline} />
      ).toLowerCase();
      for (const forbidden of [
        '<script',
        'javascript:',
        'data:',
        'http://',
        'https://',
        'href',
        ' on',
      ]) {
        expect(html).not.toContain(forbidden);
      }
    }
  );

  it('gives every discipline a different drawing', () => {
    const drawings = disciplines.map((discipline) =>
      renderToStaticMarkup(<DisciplineIcon discipline={discipline} />).replace(
        /data-discipline="[^"]*"/,
        ''
      )
    );
    expect(new Set(drawings).size).toBe(disciplines.length);
  });

  it('accepts a size and classes for color', () => {
    const html = renderToStaticMarkup(
      <DisciplineIcon discipline="montana" size={48} className="text-ocre" />
    );
    expect(html).toContain('width="48"');
    expect(html).toContain('class="text-ocre"');
  });
});
