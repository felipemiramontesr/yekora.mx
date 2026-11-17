// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages, type Locale } from '@/app/i18n';
import type { SavedCard } from '@/lib/account/paymentMethodTypes';
import {
  detachPaymentMethod,
  listPaymentMethods,
  startPaymentMethodSetup,
} from '@/lib/api/paymentMethodsClient';
import { AccountPaymentMethods } from './AccountPaymentMethods';

vi.mock('@/lib/api/paymentMethodsClient', () => ({
  detachPaymentMethod: vi.fn(),
  listPaymentMethods: vi.fn(),
  startPaymentMethodSetup: vi.fn(),
}));

const api = {
  detach: vi.mocked(detachPaymentMethod),
  list: vi.mocked(listPaymentMethods),
  setup: vi.mocked(startPaymentMethodSetup),
};

const ok = <T,>(data: T) => ({ ok: true as const, data });
const no = (reason: string) => ({ ok: false as const, reason }) as never;

const VISA: SavedCard = {
  id: 'pm_1Visa000000001',
  brand: 'visa',
  last4: '4242',
  expMonth: 3,
  expYear: 2031,
};
const AMEX: SavedCard = {
  id: 'pm_1Amex000000002',
  brand: 'amex',
  last4: '0005',
  expMonth: 11,
  expYear: 2029,
};
const UNKNOWN: SavedCard = {
  id: 'pm_1Other000000003',
  brand: 'cartes_bancaires',
  last4: '1111',
  expMonth: 12,
  expYear: 2030,
};

const assign = vi.fn();

function renderCards(locale: Locale = 'es-MX') {
  return render(
    <AccountPaymentMethods
      messages={getMessages(locale).account}
      locale={locale}
    />
  );
}

const listing = (items: SavedCard[]) =>
  api.list.mockResolvedValue(ok({ items, hasCustomer: items.length > 0 }));

beforeEach(() => {
  vi.stubGlobal('location', { assign });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('AccountPaymentMethods (FC 054 F1, T2.4, T2.6)', () => {
  it('shows each card with its brand, last four digits and expiry, and nothing else', async () => {
    listing([VISA, AMEX, UNKNOWN]);
    renderCards();
    expect(screen.getByText('Cargando tus tarjetas…')).toBeTruthy();
    expect(
      await screen.findByRole('heading', { name: 'Visa terminada en 4242' })
    ).toBeTruthy();
    expect(screen.getByText('Vence 03/2031')).toBeTruthy();
    expect(
      screen.getByRole('heading', {
        name: 'American Express terminada en 0005',
      })
    ).toBeTruthy();
    expect(screen.getByText('Vence 11/2029')).toBeTruthy();
    // A brand the page does not list is still a card, never an empty name.
    expect(
      screen.getByRole('heading', { name: 'Tarjeta terminada en 1111' })
    ).toBeTruthy();
    expect(
      screen.queryByText('Todavía no tienes tarjetas guardadas.')
    ).toBeNull();
  });

  it('says there are no cards, in English too, and explains where the card is typed', async () => {
    listing([]);
    renderCards('en');
    expect(
      await screen.findByText('You have no saved cards yet.')
    ).toBeTruthy();
    expect(
      screen.getByText(/Stripe captures and keeps your card details/)
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add a card' })).toBeTruthy();
  });

  it('tells that Mercado Pago manages its own methods and keeps nothing here (T2.4)', async () => {
    listing([]);
    renderCards();
    await screen.findByText('Todavía no tienes tarjetas guardadas.');
    const card = screen.getByRole('region', { name: 'Mercado Pago' });
    expect(
      within(card).getByText(
        /se administran directamente dentro de Mercado Pago/
      )
    ).toBeTruthy();
  });

  it('opens Stripe’s page to add a card, in the language of the page', async () => {
    listing([]);
    api.setup.mockResolvedValue(
      ok({ redirectUrl: 'https://checkout.stripe.com/c/pay/cs_test_1' })
    );
    renderCards('en');
    fireEvent.click(await screen.findByRole('button', { name: 'Add a card' }));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(
        'https://checkout.stripe.com/c/pay/cs_test_1'
      )
    );
    expect(api.setup).toHaveBeenCalledWith('en');
    // It stays off while the page leaves, so a second click cannot open a second session.
    expect(
      (
        screen.getByRole('button', {
          name: 'Opening Stripe’s secure page…',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });

  it('never opens a page that is not Stripe’s, whatever the answer says', async () => {
    listing([]);
    api.setup.mockResolvedValue(
      ok({ redirectUrl: 'https://evil.example/pay' })
    );
    renderCards();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Agregar tarjeta' })
    );
    expect(
      await screen.findByText(
        'No pudimos completar la solicitud. Intenta de nuevo.'
      )
    ).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
    expect(
      (
        screen.getByRole('button', {
          name: 'Agregar tarjeta',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
  });

  it('says why Stripe’s page could not be opened and lets the person try again', async () => {
    listing([]);
    api.setup.mockResolvedValue(no('SERVICE_UNAVAILABLE'));
    renderCards();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Agregar tarjeta' })
    );
    expect(
      await screen.findByText(
        'No podemos consultar tus tarjetas en este momento. Intenta más tarde.'
      )
    ).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });

  it('asks before removing, removes only after the yes, and tells it through the live region', async () => {
    api.list
      .mockResolvedValueOnce(ok({ items: [VISA, AMEX], hasCustomer: true }))
      .mockResolvedValueOnce(ok({ items: [AMEX], hasCustomer: true }));
    api.detach.mockResolvedValue(ok({ detached: true as const }));
    renderCards();
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Eliminar: Visa terminada en 4242',
      })
    );
    expect(api.detach).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', {
      name: '¿Eliminar esta tarjeta?',
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Sí, eliminar' })
    );
    await waitFor(() => expect(api.detach).toHaveBeenCalledWith(VISA.id));
    expect(
      await screen.findByText('Eliminamos la tarjeta de tu cuenta.')
    ).toBeTruthy();
    expect(
      screen
        .getByText('Eliminamos la tarjeta de tu cuenta.')
        .closest('output')
        ?.getAttribute('aria-live')
    ).toBe('polite');
    expect(
      screen.queryByRole('heading', { name: 'Visa terminada en 4242' })
    ).toBeNull();
    expect(
      screen.getByRole('heading', {
        name: 'American Express terminada en 0005',
      })
    ).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the card when the person changes their mind', async () => {
    listing([VISA]);
    renderCards();
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Eliminar: Visa terminada en 4242',
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Conservar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.detach).not.toHaveBeenCalled();
    expect(
      screen.getByRole('heading', { name: 'Visa terminada en 4242' })
    ).toBeTruthy();
  });

  it('says so and shows the list again when the card was already gone', async () => {
    api.list
      .mockResolvedValueOnce(ok({ items: [VISA], hasCustomer: true }))
      .mockResolvedValueOnce(ok({ items: [], hasCustomer: true }));
    api.detach.mockResolvedValue(no('PAYMENT_METHOD_NOT_FOUND'));
    renderCards();
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Eliminar: Visa terminada en 4242',
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sí, eliminar' }));
    expect(
      await screen.findByText('Esa tarjeta ya no está en tu cuenta.')
    ).toBeTruthy();
    expect(
      await screen.findByText('Todavía no tienes tarjetas guardadas.')
    ).toBeTruthy();
  });

  it('keeps the list and says why when Stripe could not detach the card', async () => {
    listing([VISA]);
    api.detach.mockResolvedValue(no('offline'));
    renderCards();
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Eliminar: Visa terminada en 4242',
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sí, eliminar' }));
    expect(
      await screen.findByText(
        'Sin conexión. Revisa tu internet e intenta de nuevo.'
      )
    ).toBeTruthy();
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('heading', { name: 'Visa terminada en 4242' })
    ).toBeTruthy();
  });

  it('says why the cards could not be read and still lets the person add one', async () => {
    api.list.mockResolvedValue(no('SERVICE_UNAVAILABLE'));
    renderCards();
    expect(
      await screen.findByText(
        'No podemos consultar tus tarjetas en este momento. Intenta más tarde.'
      )
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Agregar tarjeta' })
    ).toBeTruthy();
  });

  it('gives every control the 44 px target and a name that says which card it acts on (T2.6)', async () => {
    listing([VISA]);
    renderCards();
    const remove = await screen.findByRole('button', {
      name: 'Eliminar: Visa terminada en 4242',
    });
    expect(remove.className).toContain('tap-target');
    expect(
      screen.getByRole('button', { name: 'Agregar tarjeta' }).className
    ).toContain('tap-target');
    fireEvent.click(remove);
    for (const name of ['Sí, eliminar', 'Conservar']) {
      expect(screen.getByRole('button', { name }).className).toContain(
        'tap-target'
      );
    }
  });
});
