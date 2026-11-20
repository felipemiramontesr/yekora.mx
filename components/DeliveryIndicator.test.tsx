// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages } from '@/app/i18n';
import { DeliveryIndicator } from './DeliveryIndicator';
import { useDeliveryLocation } from './useDeliveryLocation';
import { useHeaderAccount } from './useHeaderAccount';

vi.mock('./useHeaderAccount', () => ({ useHeaderAccount: vi.fn() }));
vi.mock('./useDeliveryLocation', () => ({ useDeliveryLocation: vi.fn() }));
const account = vi.mocked(useHeaderAccount);
const location = vi.mocked(useDeliveryLocation);
const messages = getMessages('es-MX').header.delivery;
const USER = {
  id: 'b0000000-0000-4000-8000-000000000001',
  email: 'ana@example.test',
  fullName: 'Ana',
  roles: ['customer'],
  permissions: ['account:self'],
};

const renderIndicator = () =>
  render(<DeliveryIndicator accountHref="/cuenta/" messages={messages} />);

beforeEach(() => location.mockReturnValue(null));
afterEach(cleanup);

describe('delivery indicator of the header (FC 047 T1.1, T2.1; FC 055 T1.2, T2.4, T2.7)', () => {
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
    // An account with an address of its own never asks the browser where it is.
    expect(location).toHaveBeenLastCalledWith(false);
  });

  it('shows the code of the browser, as a link to the data of the account, when the account has no address', () => {
    account.mockReturnValue({
      firstName: 'Ana',
      user: { ...USER, postalCode: null },
    });
    location.mockReturnValue('06600');
    renderIndicator();
    const link = screen.getByRole('link', {
      name: 'Enviar al código postal 06600',
    });
    expect(link.getAttribute('href')).toBe('/cuenta/');
    expect(link.textContent).toBe('06600');
    expect(location).toHaveBeenLastCalledWith(true);
  });

  it('stays silent for an account without an address when the browser gives no code', () => {
    account.mockReturnValue({
      firstName: 'Ana',
      user: { ...USER, postalCode: null },
    });
    const { container } = renderIndicator();
    expect(container.innerHTML).toBe('');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('holds the place of the code, silently, while the session is being confirmed', () => {
    account.mockReturnValue({ firstName: 'Ana', user: null });
    const { container } = renderIndicator();
    expect(screen.queryByRole('link')).toBeNull();
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe(
      'true'
    );
    // Until the account answers there is nothing to compare: the location is not asked yet.
    expect(location).toHaveBeenLastCalledWith(false);
  });

  it('shows a visitor the code of the browser as plain text, named for assistive technology', () => {
    account.mockReturnValue({ firstName: null, user: null });
    location.mockReturnValue('98000');
    const { container } = renderIndicator();
    expect(screen.queryByRole('link')).toBeNull();
    expect(container.textContent).toContain('Enviar al código postal 98000');
    expect(container.querySelector('[aria-hidden="true"]')?.tagName).toBe(
      'svg'
    );
    expect(location).toHaveBeenLastCalledWith(true);
  });

  it('shows a visitor nothing, with no link and no question, when there is no code', () => {
    account.mockReturnValue({ firstName: null, user: null });
    const { container } = renderIndicator();
    expect(container.innerHTML).toBe('');
    expect(screen.queryByRole('link')).toBeNull();
  });
});
