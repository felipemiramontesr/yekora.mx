// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMessages } from '@/app/i18n';
import { AccountSidebar } from './AccountSidebar';

const texts = getMessages('es-MX').account.dashboard;
const USER = {
  id: 'b0000000-0000-4000-8000-000000000001',
  email: 'ana@example.test',
  fullName: 'ana flores baca',
  roles: ['customer'],
  permissions: ['account:self'],
};
const SECTIONS = [
  { tab: 'orders', label: 'Mis pedidos', href: '/cuenta/' },
  { tab: 'panel', label: 'Panel: pedidos', href: '/cuenta/panel/' },
  { tab: 'catalog', label: 'Catálogo', href: '/cuenta/catalogo/' },
  { tab: 'admins', label: 'Administradores', href: '/cuenta/admins/' },
] as const;

const setup = (over: Partial<Parameters<typeof AccountSidebar>[0]> = {}) => {
  const props = {
    user: USER,
    texts,
    sections: SECTIONS,
    active: 'orders' as const,
    expanded: false,
    onToggleExpanded: vi.fn(),
    drawerOpen: false,
    onCloseDrawer: vi.fn(),
    onSelect: vi.fn(),
    onForgetDevice: vi.fn(),
    forgetting: false,
    onSignOut: vi.fn(),
    leaving: false,
    ...over,
  };
  render(<AccountSidebar {...props} />);
  return props;
};

afterEach(cleanup);

describe('account sidebar (FC 046 T1.2, T2.3)', () => {
  it('shows initials and name, never the e-mail, and the Owner badge only for owners', () => {
    setup();
    expect(screen.getByText('AF')).toBeTruthy();
    expect(screen.getByText('ana flores baca')).toBeTruthy();
    expect(screen.queryByText(/example\.test/)).toBeNull();
    expect(screen.queryByText('Owner')).toBeNull();
    cleanup();
    setup({ user: { ...USER, roles: ['owner'] } });
    expect(screen.getByText('Owner')).toBeTruthy();
  });

  it('marks the active section, titles the icons when folded and selects without navigating', () => {
    const props = setup();
    const current = screen.getByRole('link', { name: 'Mis pedidos' });
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(current.getAttribute('title')).toBe('Mis pedidos');
    expect(current.className).toContain('border-ocre');
    fireEvent.click(screen.getByRole('link', { name: 'Catálogo' }));
    expect(props.onSelect).toHaveBeenCalledWith('catalog');
  });

  it('shows names without titles when expanded, and toggles with aria-expanded', () => {
    const props = setup({ expanded: true });
    expect(
      screen.getByRole('link', { name: 'Mis pedidos' }).getAttribute('title')
    ).toBeNull();
    const toggle = screen.getByRole('button', {
      name: 'Replegar la barra lateral',
    });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(props.onToggleExpanded).toHaveBeenCalled();
  });

  it('offers the foot actions, and shows their busy state', () => {
    const props = setup();
    fireEvent.click(
      screen.getByRole('button', { name: 'Olvidar este dispositivo' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Salir' }));
    expect(props.onForgetDevice).toHaveBeenCalled();
    expect(props.onSignOut).toHaveBeenCalled();
    cleanup();
    setup({ forgetting: true, leaving: true });
    expect(
      (
        screen
          .getByText(texts.signingOut)
          .closest('button') as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(screen.getByText(texts.forgettingDevice)).toBeTruthy();
  });

  it('as a drawer takes the focus and closes with Escape, its button or the backdrop', () => {
    const props = setup({ drawerOpen: true });
    const closers = screen.getAllByRole('button', { name: 'Cerrar el menú' });
    expect(document.activeElement).toBe(closers[1]);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(props.onCloseDrawer).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onCloseDrawer).toHaveBeenCalledTimes(1);
    fireEvent.click(closers[0]);
    fireEvent.click(closers[1]);
    expect(props.onCloseDrawer).toHaveBeenCalledTimes(3);
  });

  it('has no backdrop and listens to no key while the drawer is closed', () => {
    const props = setup();
    expect(
      screen.queryAllByRole('button', { name: 'Cerrar el menú' })
    ).toHaveLength(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onCloseDrawer).not.toHaveBeenCalled();
  });
});
