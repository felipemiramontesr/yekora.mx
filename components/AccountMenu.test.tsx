// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages } from '@/app/i18n';
import { signOutFromHeader } from '@/lib/account/headerSession';
import { forgetDevice } from '@/lib/api/accountClient';
import { AccountMenu } from './AccountMenu';
import { useHeaderAccount } from './useHeaderAccount';

let pathname: string | null = '/cuenta/';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
vi.mock('./useHeaderAccount', () => ({ useHeaderAccount: vi.fn() }));
vi.mock('@/lib/account/headerSession', () => ({ signOutFromHeader: vi.fn() }));
vi.mock('@/lib/api/accountClient', () => ({ forgetDevice: vi.fn() }));

const account = vi.mocked(useHeaderAccount);
const leave = vi.mocked(signOutFromHeader);
const forget = vi.mocked(forgetDevice);
const messages = getMessages('es-MX');
const BUYER = {
  id: 'b0000000-0000-4000-8000-000000000001',
  email: 'ana@example.test',
  fullName: 'Ana Flores Baca',
  roles: ['customer'],
  permissions: ['account:self'],
  postalCode: '98000',
};

const renderMenu = () =>
  render(
    <AccountMenu
      locale="es-MX"
      area="/cuenta/"
      messages={messages.header}
      dashboard={messages.account.dashboard}
      languageMessages={messages.languageSwitcher}
    />
  );

beforeEach(() => {
  pathname = '/cuenta/';
  leave.mockResolvedValue(undefined);
  forget.mockResolvedValue({ ok: true, data: null } as never);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('account menu of the header (FC 047 T1.1, T2.4)', () => {
  it('offers a visitor «Entrar», «Crear cuenta» and the language, and no session actions', () => {
    account.mockReturnValue({ firstName: null, user: null });
    renderMenu();
    // The name of the trigger is its own text: «Entrar» and «Mi cuenta».
    expect(document.querySelector('summary')?.textContent).toBe(
      'EntrarMi cuenta'
    );
    expect(
      screen.getByRole('link', { name: 'Entrar' }).getAttribute('href')
    ).toBe('/cuenta/');
    expect(
      screen.getByRole('link', { name: 'Crear cuenta' }).getAttribute('href')
    ).toBe('/cuenta/?action=register');
    expect(screen.getByRole('link', { name: 'ES, Español' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Salir' })).toBeNull();
  });

  it('greets by first name and, until the API confirms the account, offers only the orders', () => {
    account.mockReturnValue({ firstName: 'Ana', user: null });
    renderMenu();
    expect(document.querySelector('summary')?.textContent).toBe(
      'Hola, AnaMi cuenta'
    );
    const nav = screen.getByRole('navigation', { name: 'Mi cuenta' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent)
    ).toEqual(['Mis pedidos']);
    expect(screen.getByText('Ana')).toBeTruthy();
  });

  it('offers a buyer their orders, marks the page they are on, and never shows the e-mail', () => {
    account.mockReturnValue({ firstName: 'Ana', user: BUYER });
    renderMenu();
    const orders = screen.getByRole('link', { name: 'Mis pedidos' });
    expect(orders.getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('Ana Flores Baca')).toBeTruthy();
    expect(screen.queryByText(/example\.test/)).toBeNull();
    expect(screen.queryByText('Owner')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Catálogo' })).toBeNull();
  });

  it('offers the sections of an owner by permission and role, with the badge', () => {
    pathname = null;
    account.mockReturnValue({
      firstName: 'Ana',
      user: {
        ...BUYER,
        roles: ['owner'],
        permissions: ['orders:read', 'catalog:write'],
      },
    });
    renderMenu();
    const nav = screen.getByRole('navigation', { name: 'Mi cuenta' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.textContent)
    ).toEqual(['Mis pedidos', 'Panel: pedidos', 'Catálogo', 'Administradores']);
    expect(
      within(nav)
        .getByRole('link', { name: 'Administradores' })
        .getAttribute('href')
    ).toBe('/cuenta/administradores/');
    expect(screen.getByText('Owner')).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'Mis pedidos' })
        .getAttribute('aria-current')
    ).toBeNull();
  });

  it('signs out through the header session, with its busy state', async () => {
    account.mockReturnValue({ firstName: 'Ana', user: BUYER });
    let finish!: () => void;
    leave.mockReturnValueOnce(
      new Promise<void>((resolve) => (finish = resolve))
    );
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Salir' }));
    const busy = screen.getByRole('button', {
      name: messages.account.dashboard.signingOut,
    });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(
      (
        screen.getByRole('button', {
          name: messages.account.dashboard.forgetDevice,
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    await act(async () => finish());
    expect(leave).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Salir' })).toBeTruthy();
  });

  it('forgets this device and says so, or says it could not', async () => {
    account.mockReturnValue({ firstName: 'Ana', user: BUYER });
    renderMenu();
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', {
          name: messages.account.dashboard.forgetDevice,
        })
      );
    });
    expect(screen.getByRole('status').textContent).toBe(
      messages.account.dashboard.deviceForgotten
    );
    forget.mockResolvedValueOnce({ ok: false, reason: 'offline' } as never);
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', {
          name: messages.account.dashboard.forgetDevice,
        })
      );
    });
    expect(screen.getByRole('status').textContent).toBe(
      messages.header.accountMenu.deviceFailed
    );
  });

  it('changes the view inside the area without reloading it: it pushes the address and tells the area', () => {
    account.mockReturnValue({
      firstName: 'Ana',
      user: { ...BUYER, permissions: ['orders:read'] },
    });
    const heard = vi.fn();
    globalThis.addEventListener('popstate', heard);
    const push = vi.spyOn(globalThis.history, 'pushState');
    renderMenu();
    const panel = screen.getByRole('link', { name: 'Panel: pedidos' });
    expect(fireEvent.click(panel)).toBe(false);
    expect(push).toHaveBeenCalledWith(null, '', '/cuenta/panel/');
    expect(heard).toHaveBeenCalledTimes(1);
    globalThis.removeEventListener('popstate', heard);
    push.mockRestore();
  });

  it('is an ordinary navigation outside the area, and with a modifier key or another button', () => {
    account.mockReturnValue({
      firstName: 'Ana',
      user: { ...BUYER, permissions: ['orders:read'] },
    });
    const push = vi.spyOn(globalThis.history, 'pushState');
    pathname = '/catalogo/';
    renderMenu();
    expect(
      fireEvent.click(screen.getByRole('link', { name: 'Panel: pedidos' }))
    ).toBe(true);
    cleanup();
    pathname = '/cuenta/';
    renderMenu();
    const panel = screen.getByRole('link', { name: 'Panel: pedidos' });
    expect(fireEvent.click(panel, { ctrlKey: true })).toBe(true);
    expect(fireEvent.click(panel, { shiftKey: true })).toBe(true);
    expect(fireEvent.click(panel, { button: 1 })).toBe(true);
    expect(push).not.toHaveBeenCalled();
    push.mockRestore();
  });

  it('opens the sign-up form from inside the area too', () => {
    account.mockReturnValue({ firstName: null, user: null });
    const push = vi.spyOn(globalThis.history, 'pushState');
    renderMenu();
    expect(
      fireEvent.click(screen.getByRole('link', { name: 'Crear cuenta' }))
    ).toBe(false);
    expect(push).toHaveBeenCalledWith(null, '', '/cuenta/?action=register');
    expect(fireEvent.click(screen.getByRole('link', { name: 'Entrar' }))).toBe(
      false
    );
    expect(push).toHaveBeenLastCalledWith(null, '', '/cuenta/');
    push.mockRestore();
  });
});
