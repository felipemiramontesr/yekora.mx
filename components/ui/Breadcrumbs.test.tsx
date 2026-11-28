// @vitest-environment jsdom
/**
 * FC 078 F0 evidence: the 16 rows of the gate of the breadcrumbs (T1.2) and its accessible markup
 * (T2.5).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
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
    expect(html).toMatch(/<li aria-current="page"[^>]*>.*Mochila<\/li>/);
  });

  it('draws nothing for a trail the gate refuses', () => {
    expect(
      renderToStaticMarkup(<Breadcrumbs label="Estás en" steps={[]} />)
    ).toBe('');
  });
});

describe('a step of an area that routes its own paths (FC 078 F4)', () => {
  it('keeps its address and takes the person there without loading a page', () => {
    const onSelect = vi.fn();
    render(
      <Breadcrumbs
        label="Estás en"
        steps={[
          { label: 'Mi cuenta', href: '/cuenta/', onSelect },
          { label: 'Pedidos' },
        ]}
      />
    );
    const link = screen.getByRole('link', { name: 'Mi cuenta' });
    expect(link.getAttribute('href')).toBe('/cuenta/');
    expect(fireEvent.click(link)).toBe(false);
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
