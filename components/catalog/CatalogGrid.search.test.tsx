// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMessages } from '@/app/i18n';
import { CatalogGrid, type GridItem } from './CatalogGrid';

let search = '';
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search),
}));

const messages = getMessages('es-MX').catalog;

function item(
  slug: string,
  name: string,
  discipline: string,
  disciplineName: string
): GridItem {
  return {
    slug,
    href: `/catalogo/${slug}/`,
    name,
    discipline,
    disciplineName,
    level: 'avanzado',
    levelName: 'Avanzado',
    priceMxnCents: 100000,
    price: { mxn: '$1,000.00 MXN', usd: null },
    inStock: true,
    image: null,
  };
}

const ITEMS = [
  item('arnes', 'Arnés alpino', 'escalada', 'Escalada'),
  item('mochila', 'Mochila ligera', 'senderismo', 'Senderismo'),
  item('tenis', 'Tenis de trail', 'trail-running', 'Trail running'),
];

const names = () =>
  within(screen.getByRole('list'))
    .getAllByRole('heading')
    .map((heading) => heading.textContent);

function renderGrid() {
  return render(
    <CatalogGrid locale="es-MX" items={ITEMS} messages={messages} />
  );
}

afterEach(() => {
  cleanup();
  search = '';
  globalThis.history.replaceState(null, '', '/');
});

describe('catalog grid filters from the address (FC 047 T2.1, T1.2)', () => {
  it('shows only the products of the discipline the strip links to', () => {
    search = 'disciplina=escalada';
    renderGrid();
    expect(names()).toEqual(['Arnés alpino']);
    expect(
      (screen.getByLabelText(messages.filters.discipline) as HTMLSelectElement)
        .value
    ).toBe('escalada');
  });

  it('shows what the search of the header found, says for what, and can drop the search', () => {
    search = 'q=ARNES';
    globalThis.history.replaceState(null, '', '/catalogo/?q=ARNES');
    renderGrid();
    expect(names()).toEqual(['Arnés alpino']);
    expect(screen.getByRole('status').textContent).toBe(
      'Resultados para «ARNES» · 1 producto'
    );
    fireEvent.click(
      screen.getByRole('button', { name: messages.filters.clearSearch })
    );
    expect(names()).toHaveLength(3);
    expect(globalThis.location.search).toBe('');
    expect(
      screen.queryByRole('button', { name: messages.filters.clearSearch })
    ).toBeNull();
  });

  it('combines the search with the discipline, and «Limpiar» drops both', () => {
    search = 'q=trail&disciplina=escalada';
    renderGrid();
    expect(screen.getByText(messages.filters.empty)).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: messages.filters.reset })
    );
    expect(names()).toHaveLength(3);
  });

  it('follows the address when it changes, and when it loses its filter', () => {
    search = 'disciplina=escalada';
    const { rerender } = renderGrid();
    expect(names()).toEqual(['Arnés alpino']);
    search = 'disciplina=senderismo';
    rerender(<CatalogGrid locale="es-MX" items={ITEMS} messages={messages} />);
    expect(names()).toEqual(['Mochila ligera']);
    search = '';
    rerender(<CatalogGrid locale="es-MX" items={ITEMS} messages={messages} />);
    expect(names()).toHaveLength(3);
  });

  it('never undoes a choice with an address that says nothing', () => {
    renderGrid();
    fireEvent.change(screen.getByLabelText(messages.filters.discipline), {
      target: { value: 'escalada' },
    });
    expect(names()).toEqual(['Arnés alpino']);
  });

  it('shows everything when the address carries no filter', () => {
    renderGrid();
    expect(names()).toHaveLength(3);
    expect(screen.getByRole('status').textContent).toBe('3 productos');
  });
});
