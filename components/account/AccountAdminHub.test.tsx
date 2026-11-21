// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMessages, type Locale } from '@/app/i18n';
import { AccountAdminHub } from './AccountAdminHub';

afterEach(cleanup);

const none = { roles: ['customer'], permissions: ['account:self'] };
const show = (
  user: { roles: string[]; permissions: string[] },
  locale: Locale = 'es-MX',
  onNavigate = vi.fn()
) => {
  render(
    <AccountAdminHub
      user={user}
      area={locale === 'en' ? '/en/account/' : '/cuenta/'}
      texts={getMessages(locale).account.adminHub}
      onNavigate={onNavigate}
    />
  );
  return onNavigate;
};
const texts = getMessages('es-MX').account.adminHub;
const names = () =>
  screen.queryAllByRole('link').map((link) => link.textContent ?? '');

describe('administration hub (FC 052 T1.1, T2.4)', () => {
  it('shows a card for each console the account may open, with what it is for', () => {
    show({
      roles: ['owner'],
      permissions: [
        'account:self',
        'orders:read',
        'catalog:write',
        'shipping:manage',
      ],
    });
    expect(screen.getByRole('heading', { name: texts.title })).toBeTruthy();
    expect(screen.getByText(texts.intro)).toBeTruthy();
    for (const card of Object.values(texts.cards)) {
      expect(screen.getByText(card.name)).toBeTruthy();
      expect(screen.getByText(card.description)).toBeTruthy();
    }
    expect(screen.getAllByText(texts.open)).toHaveLength(5);
  });

  it.each([
    ['nothing', none, []],
    ['orders:read', { ...none, permissions: ['orders:read'] }, ['Pedidos']],
    [
      'catalog:write',
      { ...none, permissions: ['catalog:write'] },
      ['Productos', 'Catálogo'],
    ],
    [
      'shipping:manage',
      { ...none, permissions: ['shipping:manage'] },
      ['Envíos'],
    ],
    [
      'the owner role',
      { roles: ['owner'], permissions: [] },
      ['Administradores'],
    ],
  ])(
    'shows, for %s, only the cards that privilege grants',
    (_case, user, shown) => {
      show(user);
      const found = names();
      expect(found).toHaveLength(shown.length);
      shown.forEach((name, index) => expect(found[index]).toContain(name));
      for (const absent of [
        'Pedidos',
        'Productos',
        'Catálogo',
        'Envíos',
        'Administradores',
      ]) {
        if (!shown.includes(absent)) {
          expect(found.some((text) => text.startsWith(absent))).toBe(false);
        }
      }
    }
  );

  it('opens a console by its own address in the area, without reloading, and in English too', () => {
    const open = show(
      {
        roles: ['owner'],
        permissions: ['orders:read', 'catalog:write', 'shipping:manage'],
      },
      'en'
    );
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/en/account/panel/',
      '/en/account/catalogo/productos/',
      '/en/account/catalogo/marcas/',
      '/en/account/envios/',
      '/en/account/administradores/',
    ]);
    // Each click is a navigation of the area, never a reload of the page.
    expect(fireEvent.click(links[1])).toBe(false);
    expect(open).toHaveBeenCalledWith({
      tab: 'catalog',
      orderNumber: null,
      section: 'productos',
    });
    fireEvent.click(links[3]);
    expect(open).toHaveBeenLastCalledWith({
      tab: 'shipping',
      orderNumber: null,
      section: null,
    });
    fireEvent.click(links[4]);
    expect(open).toHaveBeenLastCalledWith({
      tab: 'admins',
      orderNumber: null,
      section: null,
    });
  });
});
