// @vitest-environment jsdom
/**
 * FC 078 F1 evidence of the header indicator (T1.1, T2.3, T2.6): always a button with two lines,
 * what it shows for an account, a visitor and nobody, and that its dialog only opens when asked.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages, type Locale } from '@/app/i18n';
import { DeliveryIndicator } from './DeliveryIndicator';
import { useDeliveryLocation } from './useDeliveryLocation';
import { useHeaderAccount } from './useHeaderAccount';

vi.mock('./useHeaderAccount', () => ({ useHeaderAccount: vi.fn() }));
vi.mock('./useDeliveryLocation', () => ({ useDeliveryLocation: vi.fn() }));
vi.mock('./DeliveryLocationModal', () => ({
  DeliveryLocationModal: ({
    signedIn,
    onClose,
  }: {
    signedIn: boolean;
    onClose: () => void;
  }) => (
    <button type="button" onClick={onClose}>
      {signedIn ? 'dialog of an account' : 'dialog of a visitor'}
    </button>
  ),
}));
const account = vi.mocked(useHeaderAccount);
const location = vi.mocked(useDeliveryLocation);
const USER = {
  id: 'b0000000-0000-4000-8000-000000000001',
  email: 'ana@example.test',
  fullName: 'Ana Karen Flores',
  roles: ['customer'],
  permissions: ['account:self'],
};

const indicator = (locale: Locale = 'es-MX') => (
  <DeliveryIndicator
    accountHref="/cuenta/"
    locale={locale}
    messages={getMessages(locale).header.delivery}
    exampleLabel="Ejemplo"
  />
);
const show = (locale: Locale = 'es-MX') => render(indicator(locale));
const trigger = () => screen.getAllByRole('button')[0];

beforeEach(() => {
  account.mockReturnValue({ firstName: null, user: null });
  location.mockReturnValue({ place: null, resolving: false });
});
afterEach(cleanup);

describe('delivery indicator of the header (FC 078 F1)', () => {
  it('invites to enter a postal code when there is nothing, and opens nothing by itself', () => {
    show();
    expect(trigger().textContent).toContain('Enviar a');
    expect(trigger().textContent).toContain('Ingresa tu C.P.');
    expect(trigger().getAttribute('aria-haspopup')).toBe('dialog');
    expect(screen.queryByText(/dialog of/)).toBeNull();
    expect(location).toHaveBeenLastCalledWith(true);
  });

  it('opens the dialog when asked and gives the focus back when it closes', () => {
    show();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByText('dialog of a visitor'));
    expect(screen.queryByText(/dialog of/)).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('shows the first name, the state and the postal code of the account, and never asks the browser', () => {
    account.mockReturnValue({
      firstName: 'Ana',
      user: { ...USER, postalCode: '98000' },
    });
    location.mockReturnValue({ place: '06600', resolving: false });
    show();
    expect(trigger().textContent).toContain('Enviar a Ana');
    expect(screen.getByText('Zac. 98000').getAttribute('aria-hidden')).toBe(
      'true'
    );
    expect(screen.getByText('Zacatecas 98000')).toBeTruthy();
    expect(location).toHaveBeenLastCalledWith(false);
    fireEvent.click(trigger());
    expect(screen.getByText('dialog of an account')).toBeTruthy();
  });

  it.each([
    ['es-MX', '06600', 'Enviar a', 'CDMX 06600', 'Ciudad de México 06600'],
    ['es-MX', 'ZAC', 'Enviar a', 'Zac.', 'Zacatecas'],
    ['en', 'MEX', 'Deliver to', 'Edomex', 'State of Mexico'],
  ])(
    'shows a visitor what the tab holds (%s %s)',
    (locale, place, label, shown, spoken) => {
      location.mockReturnValue({ place, resolving: false });
      show(locale as Locale);
      expect(trigger().textContent).toContain(label);
      expect(
        screen.getByText(shown, { selector: '[aria-hidden]' })
      ).toBeTruthy();
      expect(screen.getByText(spoken, { selector: '.sr-only' })).toBeTruthy();
    }
  );

  it('shows a code of no known state as it is', () => {
    account.mockReturnValue({
      firstName: 'Ana',
      user: { ...USER, postalCode: '00000' },
    });
    show();
    expect(screen.getByText('00000', { selector: '.sr-only' })).toBeTruthy();
  });

  it.each([
    ['the session is being confirmed', { firstName: 'Ana', user: null }, false],
    ['the location is being resolved', { firstName: null, user: null }, true],
  ])('holds its box while %s', (_case, who, resolving) => {
    account.mockReturnValue(who);
    location.mockReturnValue({ place: null, resolving });
    show();
    expect(trigger().textContent).not.toContain('Ingresa tu C.P.');
    expect(trigger().querySelector('span.h-4')).toBeTruthy();
  });

  it('is prerendered as a held box that cannot be pressed yet', () => {
    const html = renderToStaticMarkup(indicator());
    expect(html).toContain('disabled=""');
    expect(html).toContain('h-4 w-16');
    expect(html).not.toContain('Ingresa tu C.P.');
  });
});
