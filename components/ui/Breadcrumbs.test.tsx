/**
 * FC 078 F0 evidence: the 16 rows of the gate of the breadcrumbs (T1.2) and its accessible markup
 * (T2.5).
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { breadcrumbsVerdict } from '@/lib/ui/breadcrumbsGate';
import { Breadcrumbs } from './Breadcrumbs';

const CODES = [
  'BREADCRUMB_STEPS_EMPTY_REJECT',
  'PARENT_HREF_MISSING_REJECT',
  'CURRENT_LEAF_INVALID_REJECT',
  'A11Y_MARKUP_DEFECTIVE_REJECT',
] as const;

describe('the gate of the breadcrumbs (T1.2)', () => {
  it.each(
    Array.from({ length: 16 }, (_, row) =>
      CODES.map((_code, bit) => (row & (8 >> bit)) === 0)
    )
  )('S=%s N=%s C=%s A=%s', (steps, parents, leaf, named) => {
    const trail = steps
      ? [
          { label: named ? 'Inicio' : ' ', href: parents ? '/' : undefined },
          { label: 'Carrito', href: leaf ? undefined : '/carrito/' },
        ]
      : [];
    const first = [steps, parents, leaf, named].indexOf(false);
    expect(breadcrumbsVerdict('Ruta', trail)).toBe(
      first === -1 ? 'BREADCRUMBS_RESOLVED' : CODES[first]
    );
  });
});

describe('Breadcrumbs (T2.5)', () => {
  it('draws a named navigation, links every step but the page and marks it current', () => {
    const html = renderToStaticMarkup(
      <Breadcrumbs
        label="Estás en"
        steps={[
          { label: 'Inicio', href: '/' },
          { label: 'Catálogo', href: '/catalogo/' },
          { label: 'Mochila' },
        ]}
      />
    );
    expect(html).toContain('<nav aria-label="Estás en"><ol');
    expect(html.match(/<li/g)).toHaveLength(3);
    expect(html.match(/<a /g)).toHaveLength(2);
    expect(html.match(/<span aria-hidden="true">›<\/span>/g)).toHaveLength(2);
    expect(html).toMatch(/<span aria-current="page"[^>]*>Mochila<\/span>/);
  });

  it('draws nothing for a trail the gate refuses', () => {
    expect(
      renderToStaticMarkup(<Breadcrumbs label="Estás en" steps={[]} />)
    ).toBe('');
  });
});
