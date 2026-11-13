// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages } from '@/app/i18n';
import {
  clearSessionFirstName,
  readSessionFirstName,
  saveSessionFirstName,
} from '@/lib/account/sessionHint';
import { logout, me } from '@/lib/api/accountClient';
import { AccountHeaderControl } from './AccountHeaderControl';

vi.mock('@/lib/api/accountClient', () => ({ me: vi.fn(), logout: vi.fn() }));

const api = { me: vi.mocked(me), logout: vi.mocked(logout) };
const messages = getMessages('es-MX').header;
const KEY = 'yekora_session_first_name_v1';

const USER = {
  id: 'b0000000-0000-4000-8000-000000000001',
  email: 'ana@example.test',
  fullName: 'Ana Flores Baca',
  roles: ['customer'],
  permissions: ['account:self'],
};
const ok = (fullName = USER.fullName) =>
  ({ ok: true as const, data: { ...USER, fullName } }) as never;
const no = (reason: string) => ({ ok: false as const, reason }) as never;

const renderControl = () =>
  render(<AccountHeaderControl href="/cuenta/" messages={messages} />);

beforeEach(() => {
  localStorage.clear();
  api.me.mockResolvedValue(ok());
  api.logout.mockResolvedValue({ ok: true, data: null } as never);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('header account control (FC 046 T1.1, T2.2)', () => {
  it('is the plain link to the account area, and never asks the API, without a hint', () => {
    renderControl();
    const link = screen.getByRole('link', { name: 'Mi cuenta' });
    expect(link.getAttribute('href')).toBe('/cuenta/');
    expect(screen.queryByRole('button', { name: 'Salir' })).toBeNull();
    expect(api.me).not.toHaveBeenCalled();
  });

  it('shows the first name with a menu when the browser keeps the hint, and checks it with the API', async () => {
    localStorage.setItem(KEY, 'Ana');
    renderControl();
    const name = await screen.findByText('Ana');
    // From xl up the name is on screen, truncated; below, only the icon, named by its label.
    expect(name.className).toContain('hidden');
    expect(name.className).toContain('xl:inline');
    expect(name.className).toContain('max-w-[10rem]');
    expect(name.className).toContain('truncate');
    expect(name.getAttribute('aria-hidden')).toBe('true');
    expect(name.closest('summary')?.getAttribute('aria-label')).toBe(
      'Mi cuenta: Ana'
    );
    await waitFor(() => expect(api.me).toHaveBeenCalledTimes(1));
    const menu = name.closest('details') as HTMLElement;
    expect(
      within(menu).getByRole('link', { name: 'Mi cuenta' }).getAttribute('href')
    ).toBe('/cuenta/');
    expect(within(menu).getByRole('button', { name: 'Salir' })).toBeTruthy();
  });

  it('keeps only the first name the API gives, replacing a stale hint', async () => {
    localStorage.setItem(KEY, 'Old');
    api.me.mockResolvedValue(ok('Luis Pérez Soto'));
    renderControl();
    await waitFor(() => expect(readSessionFirstName()).toBe('Luis'));
    const name = await screen.findByText('Luis');
    expect(name.closest('summary')?.getAttribute('aria-label')).toBe(
      'Mi cuenta: Luis'
    );
    expect(localStorage.getItem(KEY)).not.toContain('Pérez');
  });

  it('erases the hint and goes back to the link when the session is found expired', async () => {
    localStorage.setItem(KEY, 'Ana');
    api.me.mockResolvedValue(no('SESSION_INVALID_OR_EXPIRED'));
    renderControl();
    await screen.findByRole('link', { name: 'Mi cuenta' });
    expect(readSessionFirstName()).toBeNull();
  });

  it('keeps the name when the API cannot be reached: offline is not a signed-out session', async () => {
    localStorage.setItem(KEY, 'Ana');
    api.me.mockResolvedValue(no('offline'));
    renderControl();
    await waitFor(() => expect(api.me).toHaveBeenCalled());
    expect(screen.getByText('Ana')).toBeTruthy();
    expect(readSessionFirstName()).toBe('Ana');
  });

  it('signs out from the menu: ends the session, erases the hint and shows the link again', async () => {
    localStorage.setItem(KEY, 'Ana');
    let finish!: (value: unknown) => void;
    api.logout.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }) as never
    );
    renderControl();
    const button = await screen.findByRole('button', { name: 'Salir' });
    fireEvent.click(button);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      finish({ ok: true, data: null });
    });
    expect(api.logout).toHaveBeenCalledTimes(1);
    expect(readSessionFirstName()).toBeNull();
    expect(await screen.findByRole('link', { name: 'Mi cuenta' })).toBeTruthy();
  });

  it('follows the hint when it changes in this tab or in another one', async () => {
    renderControl();
    expect(screen.queryByText('Rosa')).toBeNull();
    act(() => saveSessionFirstName('Rosa'));
    expect(await screen.findByText('Rosa')).toBeTruthy();
    act(() => clearSessionFirstName());
    expect(await screen.findByRole('link', { name: 'Mi cuenta' })).toBeTruthy();
    // Signed in from another tab: the storage event carries the change.
    localStorage.setItem(KEY, 'Lupe');
    act(() => {
      globalThis.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    });
    expect(await screen.findByText('Lupe')).toBeTruthy();
  });
});
