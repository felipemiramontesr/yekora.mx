// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { getMessages, type Locale } from '@/app/i18n';
import { CatalogGrid, type GridItem } from './CatalogGrid';

afterEach(cleanup);

function item(overrides: Partial<GridItem> & Pick<GridItem, 'slug'>): GridItem {
  return {
    href: `/en/catalog/${overrides.slug}/`,
    name: overrides.slug,
    discipline: 'escalada',
    disciplineName: 'Climbing',
    brandName: null,
    priceMxnCents: 100000,
    price: { mxn: '$1,000.00 MXN', usd: null },
    inStock: true,
    image: null,
    ...overrides,
  };
}

const ITEMS = [
  item({
    slug: 'harness',
    name: 'Harness',
    priceMxnCents: 485000,
    price: { mxn: '$4,850.00 MXN', usd: '$262.16 USD' },
    image: {
      path: '/v1/media/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      alt: 'Harness photo',
    },
  }),
  item({
    slug: 'backpack',
    name: 'Backpack',
    discipline: 'senderismo',
    disciplineName: 'Hiking',
    priceMxnCents: 185000,
  }),
  item({
    slug: 'shoes',
    name: 'Shoes',
    discipline: 'trail-running',
    disciplineName: 'Trail running',
    priceMxnCents: 259900,
    inStock: false,
  }),
];

function show(locale: Locale = 'en', items = ITEMS) {
  render(
    <CatalogGrid
      locale={locale}
      items={items}
      messages={getMessages(locale).catalog}
    />
  );
}

const names = () =>
  screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
const choose = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('CatalogGrid', () => {
  it('lists every product by name with prices, stock and its page link', () => {
    show();
    expect(names()).toEqual(['Backpack', 'Harness', 'Shoes']);
    expect(screen.getByRole('status').textContent).toBe('3 products');
    expect(screen.getByText('≈ $262.16 USD')).toBeTruthy();
    expect(screen.getByText('Out of stock')).toBeTruthy();
    expect(screen.getAllByText('In stock')).toHaveLength(2);
    expect(
      screen.getByRole('link', { name: /Harness/ }).getAttribute('href')
    ).toBe('/en/catalog/harness/');
    expect(screen.getByAltText('Harness photo')).toBeTruthy();
  });

  it('names each select exactly by its label, not by the selected option', () => {
    show();
    for (const name of ['Discipline', 'Sort by']) {
      expect(screen.getByRole('combobox', { name })).toBeTruthy();
    }
  });

  it('offers only the disciplines present, sorted by name, and no level (FC 048)', () => {
    show();
    const options = (label: string) =>
      [...screen.getByLabelText(label).querySelectorAll('option')].map(
        (option) => option.textContent
      );
    expect(options('Discipline')).toEqual([
      'All disciplines',
      'Climbing',
      'Hiking',
      'Trail running',
    ]);
    expect(screen.queryByLabelText('Level')).toBeNull();
  });

  it('filters by discipline, with a singular count', () => {
    show();
    choose('Discipline', 'senderismo');
    expect(names()).toEqual(['Backpack']);
    expect(screen.getByRole('status').textContent).toBe('1 product');
    choose('Discipline', 'trail-running');
    expect(names()).toEqual(['Shoes']);
  });

  it('sorts by price both ways and back by name', () => {
    show();
    choose('Sort by', 'price_asc');
    expect(names()).toEqual(['Backpack', 'Shoes', 'Harness']);
    choose('Sort by', 'price_desc');
    expect(names()).toEqual(['Harness', 'Shoes', 'Backpack']);
    choose('Sort by', 'name');
    expect(names()).toEqual(['Backpack', 'Harness', 'Shoes']);
  });

  it('speaks Spanish on Spanish pages', () => {
    show('es-MX', [ITEMS[1]]);
    expect(screen.getByRole('status').textContent).toBe('1 producto');
    expect(screen.getByLabelText('Disciplina')).toBeTruthy();
    expect(screen.getByText('Disponible')).toBeTruthy();
  });
});

describe('CatalogGrid hydration guard (FC 035 T1.1, 256_AN)', () => {
  const element = (
    <CatalogGrid
      locale="en"
      items={ITEMS}
      messages={getMessages('en').catalog}
    />
  );

  it('ships the static HTML with every select disabled, so no choice can be lost', () => {
    const host = document.createElement('div');
    host.innerHTML = renderToString(element);
    const selects = [...host.querySelectorAll('select')];
    expect(selects).toHaveLength(2);
    expect(selects.every((select) => select.disabled)).toBe(true);
  });

  it('enables every select once React has hydrated the static HTML', async () => {
    const host = document.createElement('div');
    host.innerHTML = renderToString(element);
    document.body.append(host);
    await act(async () => {
      hydrateRoot(host, element);
    });
    const selects = [...host.querySelectorAll('select')];
    expect(selects.every((select) => !select.disabled)).toBe(true);
    host.remove();
  });
});
