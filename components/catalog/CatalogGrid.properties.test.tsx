// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getMessages } from '@/app/i18n';
import { CatalogGrid, type GridItem } from './CatalogGrid';

type GridProperty = GridItem['properties'][number];

afterEach(cleanup);

const property = (
  groupCode: string,
  groupName: string,
  valueCode: string,
  valueName: string,
  isFilterable = true
): GridProperty => ({
  groupCode,
  groupName,
  valueCode,
  valueName,
  isFilterable,
});

const NYLON = property('material', 'Material', 'nylon', 'Nylon');
const RED = property('color', 'Color', 'rojo', 'Red');
const BLUE = property('color', 'Color', 'azul', 'Blue');
const WARRANTY = property('garantia', 'Warranty', 'dos', 'Two years', false);

function item(
  slug: string,
  discipline: string,
  properties: GridProperty[]
): GridItem {
  return {
    slug,
    href: `/en/catalog/${slug}/`,
    name: slug,
    discipline,
    disciplineName: discipline,
    brandName: null,
    properties,
    priceMxnCents: 100000,
    price: { mxn: '$1,000.00 MXN', usd: null },
    inStock: true,
    image: null,
  };
}

const ITEMS = [
  item('harness', 'escalada', [NYLON, RED, WARRANTY]),
  item('backpack', 'senderismo', [NYLON, BLUE]),
  item('shoes', 'trail-running', [RED]),
];

const messages = getMessages('en').catalog;
const names = () =>
  screen.queryAllByRole('heading', { level: 2 }).map((h) => h.textContent);
const choose = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

function show(items = ITEMS) {
  render(<CatalogGrid locale="en" items={items} messages={messages} />);
}

describe('property filters of the catalog grid (FC 048 T1.2, T2.4)', () => {
  it('builds one filter per filterable group the products carry, with only the values present', () => {
    show();
    const options = (label: string) =>
      [...screen.getByLabelText(label).querySelectorAll('option')].map(
        (option) => option.textContent
      );
    expect(options('Material')).toEqual(['Any', 'Nylon']);
    expect(options('Color')).toEqual(['Any', 'Blue', 'Red']);
    // A group that is not filterable gives no filter; and none stands for the level any more.
    expect(screen.queryByLabelText('Warranty')).toBeNull();
    expect(screen.queryByLabelText('Level')).toBeNull();
  });

  it('puts the filters in the order the store gives them, after the discipline', () => {
    show();
    const labels = [...document.querySelectorAll('select')].map(
      (select) => (select.labels?.[0] as HTMLLabelElement).textContent
    );
    expect(labels).toEqual(['Discipline', 'Material', 'Color', 'Sort by']);
  });

  it('narrows to the products that have the chosen value, and any brings them back', () => {
    show();
    choose('Color', 'rojo');
    expect(names()).toEqual(['harness', 'shoes']);
    expect(screen.getByRole('status').textContent).toBe('2 products');
    choose('Color', '');
    expect(names()).toHaveLength(3);
  });

  it('combines filters of several groups and the discipline', () => {
    show();
    choose('Material', 'nylon');
    choose('Color', 'rojo');
    expect(names()).toEqual(['harness']);
    choose('Discipline', 'senderismo');
    expect(screen.getByText(messages.filters.empty)).toBeTruthy();
  });

  it('clears the properties too when the filters are cleared', () => {
    show();
    choose('Color', 'azul');
    choose('Discipline', 'escalada');
    fireEvent.click(
      screen.getByRole('button', { name: messages.filters.reset })
    );
    expect(names()).toHaveLength(3);
    expect((screen.getByLabelText('Color') as HTMLSelectElement).value).toBe(
      ''
    );
  });

  it('offers no property filter for products that carry none', () => {
    show([item('plain', 'escalada', [])]);
    expect(
      within(document.body)
        .getAllByRole('combobox')
        .map((box) => box.tagName)
    ).toEqual(['SELECT', 'SELECT']);
  });
});
