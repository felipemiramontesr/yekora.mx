// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages } from '@/app/i18n';
import { SearchCombobox } from './SearchCombobox';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const messages = getMessages('es-MX').header.search;
const INDEX = [
  {
    slug: 'arnes-alpino',
    name: 'Arnés alpino',
    discipline: 'escalada',
    disciplineName: 'Escalada',
  },
  {
    slug: 'arnes-cascada',
    name: 'Arnés de cañonismo',
    discipline: 'canonismo',
    disciplineName: 'Cañonismo',
  },
  {
    slug: 'mochila',
    name: 'Mochila ligera',
    discipline: 'senderismo',
    disciplineName: 'Senderismo',
  },
];
const fetchIndex = vi.fn();

function renderBox(locale: 'es-MX' | 'en' = 'es-MX') {
  render(
    <SearchCombobox
      locale={locale}
      action="/catalogo/"
      indexUrl="/search-index.json"
      messages={messages}
    />
  );
  return screen.getByRole('combobox') as HTMLInputElement;
}

const typeInto = (box: HTMLInputElement, value: string) =>
  fireEvent.change(box, { target: { value } });

beforeEach(() => {
  fetchIndex.mockResolvedValue({ ok: true, json: async () => INDEX });
  vi.stubGlobal('fetch', fetchIndex);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('header search combobox (FC 047 T1.2, T2.2)', () => {
  it('is a search form of the catalog even without JavaScript, and loads nothing until focused', () => {
    const box = renderBox();
    const form = box.closest('form') as HTMLFormElement;
    expect(form.getAttribute('role')).toBe('search');
    expect(form.getAttribute('action')).toBe('/catalogo/');
    expect(form.getAttribute('method')).toBe('get');
    expect(box.getAttribute('name')).toBe('q');
    expect(box.getAttribute('aria-autocomplete')).toBe('list');
    expect(box.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('button', { name: messages.submit })).toBeTruthy();
    expect(fetchIndex).not.toHaveBeenCalled();
  });

  it('keeps what was typed before the page hydrated, and suggests from it', async () => {
    const element = (
      <SearchCombobox
        locale="es-MX"
        action="/catalogo/"
        indexUrl="/search-index.json"
        messages={messages}
      />
    );
    const container = document.createElement('div');
    document.body.append(container);
    container.innerHTML = renderToString(element);
    try {
      const typed = container.querySelector('input') as HTMLInputElement;
      typed.value = 'arnes';
      await act(async () => {
        hydrateRoot(container, element);
      });
      expect(typed.value).toBe('arnes');
      fireEvent.focus(typed);
      expect(await screen.findAllByRole('option')).toHaveLength(2);
    } finally {
      container.remove();
    }
  });

  it('fetches the index once, on the first focus', async () => {
    const box = renderBox();
    fireEvent.focus(box);
    fireEvent.blur(box);
    fireEvent.focus(box);
    expect(fetchIndex).toHaveBeenCalledTimes(1);
    expect(fetchIndex).toHaveBeenCalledWith('/search-index.json');
  });

  it('lists suggestions as options, announces how many, and follows the arrows', async () => {
    const box = renderBox();
    fireEvent.focus(box);
    typeInto(box, 'arnes');
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Arnés alpinoEscalada',
      'Arnés de cañonismoCañonismo',
    ]);
    expect(box.getAttribute('aria-expanded')).toBe('true');
    expect(box.getAttribute('aria-controls')).toBe(
      screen.getByRole('listbox').id
    );
    expect(screen.getByRole('status').textContent).toBe('2 sugerencias');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(box.getAttribute('aria-activedescendant')).toBe(options[0].id);
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(box.getAttribute('aria-activedescendant')).toBe(options[0].id);
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    expect(box.getAttribute('aria-activedescendant')).toBe(options[1].id);
  });

  it('starts from the last suggestion with the up arrow', async () => {
    const box = renderBox();
    fireEvent.focus(box);
    typeInto(box, 'arnes');
    const options = await screen.findAllByRole('option');
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    expect(box.getAttribute('aria-activedescendant')).toBe(options[1].id);
  });

  it('opens the highlighted product with Enter, in the page language, and sends the form with none', async () => {
    const box = renderBox('en');
    fireEvent.focus(box);
    typeInto(box, 'mochila');
    await screen.findAllByRole('option');
    expect(fireEvent.keyDown(box, { key: 'Enter' })).toBe(true);
    expect(push).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(fireEvent.keyDown(box, { key: 'Enter' })).toBe(false);
    expect(push).toHaveBeenCalledWith('/en/catalog/mochila/');
    expect(box.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens a product by clicking its suggestion, keeping the focus in the box until then', async () => {
    const box = renderBox();
    fireEvent.focus(box);
    typeInto(box, 'arnes');
    const [first] = await screen.findAllByRole('option');
    expect(fireEvent.mouseDown(first)).toBe(false);
    fireEvent.click(first);
    expect(push).toHaveBeenCalledWith('/catalogo/arnes-alpino/');
  });

  it('closes with Escape, when the focus leaves, or on a click elsewhere, and reopens by typing', async () => {
    const box = renderBox();
    fireEvent.focus(box);
    typeInto(box, 'arnes');
    await screen.findAllByRole('option');
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    typeInto(box, 'arnes ');
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.blur(box, { relatedTarget: document.body });
    expect(screen.queryByRole('listbox')).toBeNull();
    typeInto(box, 'arne');
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
    typeInto(box, 'arnes');
    fireEvent.mouseDown(box);
    fireEvent.blur(box, {
      relatedTarget: screen.getByRole('button', { name: messages.submit }),
    });
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('says so, and still searches the whole store, when nothing is suggested', async () => {
    const box = renderBox();
    fireEvent.focus(box);
    typeInto(box, 'zzz');
    await waitFor(() =>
      expect(screen.getAllByText(/Sin sugerencias para «zzz»/)).toHaveLength(2)
    );
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(fireEvent.keyDown(box, { key: 'ArrowDown' })).toBe(true);
  });

  it('says suggestions are unavailable when the index cannot be read, and the form still works', async () => {
    fetchIndex.mockResolvedValueOnce({ ok: false, status: 404 });
    const box = renderBox();
    fireEvent.focus(box);
    typeInto(box, 'arnes');
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(messages.loadFailed)
    );
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('treats an index of another shape as unavailable', async () => {
    fetchIndex.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ nope: 1 }),
    });
    const box = renderBox();
    fireEvent.focus(box);
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(messages.loadFailed)
    );
  });
});
