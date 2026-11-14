// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMessages } from '@/app/i18n';
import { DeliveryIndicator } from './DeliveryIndicator';
import { useHeaderAccount } from './useHeaderAccount';

vi.mock('./useHeaderAccount', () => ({ useHeaderAccount: vi.fn() }));
const account = vi.mocked(useHeaderAccount);
const messages = getMessages('es-MX').header.delivery;
const USER = {
  id: 'b0000000-0000-4000-8000-000000000001',
  email: 'ana@example.test',
  fullName: 'Ana',
  roles: ['customer'],
  permissions: ['account:self'],
};

const renderIndicator = () =>
  render(
    <DeliveryIndicator
      accountHref="/cuenta/"
      registerHref="/cuenta/?action=register"
      messages={messages}
    />
  );

afterEach(cleanup);

describe('delivery indicator of the header (FC 047 T1.1, T2.1)', () => {
  it('shows a pin and only the postal code of the account, named for assistive technology', () => {
    account.mockReturnValue({
      firstName: 'Ana',
      user: { ...USER, postalCode: '98000' },
    });
    renderIndicator();
    const link = screen.getByRole('link', {
      name: 'Enviar al código postal 98000',
    });
    expect(link.getAttribute('href')).toBe('/cuenta/');
    expect(link.textContent).toBe('98000');
  });

  it('invites an account without a postal code to add it', () => {
    account.mockReturnValue({
      firstName: 'Ana',
      user: { ...USER, postalCode: null },
    });
    renderIndicator();
    const link = screen.getByRole('link', { name: messages.add });
    expect(link.getAttribute('href')).toBe('/cuenta/');
    expect(link.getAttribute('title')).toBe(messages.addHint);
  });

  it('holds the place of the code, silently, while the session is being confirmed', () => {
    account.mockReturnValue({ firstName: 'Ana', user: null });
    const { container } = renderIndicator();
    expect(screen.queryByRole('link')).toBeNull();
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe(
      'true'
    );
  });

  it('invites a visitor to create an account with their postal code', () => {
    account.mockReturnValue({ firstName: null, user: null });
    renderIndicator();
    const link = screen.getByRole('link', { name: messages.guest });
    expect(link.getAttribute('href')).toBe('/cuenta/?action=register');
    expect(link.getAttribute('title')).toBe(messages.guestHint);
  });
});
