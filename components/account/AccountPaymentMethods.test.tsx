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
  settlePaymentMethods,
  startPaymentMethodSetup,
} from '@/lib/api/paymentMethodsClient';
import { AccountPaymentMethods } from './AccountPaymentMethods';

vi.mock('@/lib/api/paymentMethodsClient', () => ({
  detachPaymentMethod: vi.fn(),
  listPaymentMethods: vi.fn(),
  settlePaymentMethods: vi.fn(),
  startPaymentMethodSetup: vi.fn(),
}));

const api = {
  detach: vi.mocked(detachPaymentMethod),
  list: vi.mocked(listPaymentMethods),
  settle: vi.mocked(settlePaymentMethods),
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

const replaceState = vi.fn();

/** jsdom has no <dialog> methods: showModal only has to open it, as the browser does. */
const showModal = vi.fn(function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
});

/** The address of the page, with what Stripe may have put in it. */
function openedAt(search = '') {
  vi.stubGlobal('location', {
    assign,
    search,
    pathname: '/cuenta/metodos-pago/',
  });
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = showModal;
  openedAt();
  vi.stubGlobal('history', { replaceState });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('AccountPaymentMethods (FC 054 F1, T2.4, T2.6)', () => {
  it('shows the one card with its brand, last four digits and expiry, and nothing else, with no default selector and no list', async () => {
    listing([VISA]);
    renderCards();
    expect(screen.getByText('Cargando tus tarjetas…')).toBeTruthy();
    expect(
      await screen.findByRole('heading', { name: 'Visa terminada en 4242' })
    ).toBeTruthy();
    expect(screen.getByText('Vence 03/2031')).toBeTruthy();
    expect(
      screen.queryByText('Todavía no tienes tarjetas guardadas.')
    ).toBeNull();
    expect(screen.queryByText(/predeterminad/i)).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('names a brand the page does not list as a card, never an empty name', async () => {
    listing([UNKNOWN]);
    renderCards();
    expect(
      await screen.findByRole('heading', { name: 'Tarjeta terminada en 1111' })
    ).toBeTruthy();
  });

  it('offers to replace the card, not to add another, when there is one (FC 057 T2.1)', async () => {
    listing([VISA]);
    renderCards();
    expect(
      await screen.findByRole('button', { name: 'Reemplazar tarjeta' })
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Agregar tarjeta' })
    ).toBeNull();
  });

  it('says Stripe Link and the wallets are independent services, in both languages (FC 057 T2.4)', async () => {
    listing([VISA]);
    renderCards();
    const section = await screen.findByRole('region', {
      name: 'Stripe Link y carteras digitales',
    });
    expect(within(section).getByText(/servicios independientes/)).toBeTruthy();
    expect(within(section).getByText(/no borra las tarjetas/)).toBeTruthy();
    cleanup();
    listing([VISA]);
    renderCards('en');
    const english = await screen.findByRole('region', {
      name: 'Stripe Link and digital wallets',
    });
    expect(within(english).getByText(/independent services/)).toBeTruthy();
    expect(within(english).getByText(/does not delete/)).toBeTruthy();
  });

  it('settles a card just added when Stripe sends the person back, tells it, and clears the mark from the address', async () => {
    openedAt('?setup=done');
    api.settle.mockResolvedValue(
      ok({ status: 'replaced' as const, paymentMethod: AMEX })
    );
    listing([AMEX]);
    renderCards();
    expect(
      await screen.findByText('Tu tarjeta nueva reemplazó a la anterior.')
    ).toBeTruthy();
    expect(api.settle).toHaveBeenCalledOnce();
    expect(replaceState).toHaveBeenCalledWith(
      null,
      '',
      '/cuenta/metodos-pago/'
    );
    expect(
      await screen.findByRole('heading', {
        name: 'American Express terminada en 0005',
      })
    ).toBeTruthy();
  });

  it('says the card was saved when it is the first one', async () => {
    openedAt('?a=1&setup=done');
    api.settle.mockResolvedValue(
      ok({ status: 'saved' as const, paymentMethod: VISA })
    );
    listing([VISA]);
    renderCards();
    expect(await screen.findByText('Guardamos tu tarjeta.')).toBeTruthy();
  });

  it('says why the new card could not be settled, and lets the person try again', async () => {
    openedAt('?setup=done');
    api.settle.mockResolvedValue(no('CARD_ATTACH_FAILED'));
    listing([]);
    renderCards();
    expect(
      await screen.findByText(
        'No encontramos una tarjeta nueva. Intenta agregarla de nuevo.'
      )
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Agregar tarjeta' })
    ).toBeTruthy();
  });

  it('does not settle when the person comes back without the mark, or after giving up at Stripe', async () => {
    openedAt('?other=1');
    listing([VISA]);
    renderCards();
    await screen.findByRole('heading', { name: 'Visa terminada en 4242' });
    expect(api.settle).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('leaves only the newest card when Stripe still holds more than one, and says so', async () => {
    api.list
      .mockResolvedValueOnce(ok({ items: [AMEX, VISA], hasCustomer: true }))
      .mockResolvedValueOnce(ok({ items: [AMEX], hasCustomer: true }));
    api.settle.mockResolvedValue(
      ok({ status: 'replaced' as const, paymentMethod: AMEX })
    );
    renderCards();
    expect(
      await screen.findByText('Tu tarjeta nueva reemplazó a la anterior.')
    ).toBeTruthy();
    expect(api.settle).toHaveBeenCalledOnce();
    expect(
      await screen.findByRole('heading', {
        name: 'American Express terminada en 0005',
      })
    ).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('says why the older card could not be removed and still shows only the newest', async () => {
    api.list.mockResolvedValue(ok({ items: [AMEX, VISA], hasCustomer: true }));
    api.settle.mockResolvedValue(no('GATEWAY_DETACH_FAILED'));
    renderCards();
    expect(
      await screen.findByText(
        'Guardamos tu tarjeta nueva, pero no pudimos quitar la anterior. Intenta de nuevo en un momento.'
      )
    ).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(
      screen.getByRole('heading', {
        name: 'American Express terminada en 0005',
      })
    ).toBeTruthy();
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
    expect(
      screen.getByText(/if you add another, it replaces the previous one/)
    ).toBeTruthy();
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
      .mockResolvedValueOnce(ok({ items: [VISA], hasCustomer: true }))
      .mockResolvedValueOnce(ok({ items: [], hasCustomer: false }));
    api.detach.mockResolvedValue(ok({ detached: true as const }));
    renderCards();
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Eliminar tarjeta: Visa terminada en 4242',
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
      await screen.findByText('Todavía no tienes tarjetas guardadas.')
    ).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks in a modal dialog the browser traps focus in, and Escape keeps the card (FC 057 T2.9)', async () => {
    listing([VISA]);
    renderCards();
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Eliminar tarjeta: Visa terminada en 4242',
      })
    );
    const dialog = screen.getByRole('dialog', {
      name: '¿Eliminar esta tarjeta?',
    });
    // Opened as a modal, not left open in the flow of the page; «Conservar» takes the focus.
    expect(showModal).toHaveBeenCalledOnce();
    expect(dialog.className).toContain('backdrop:');
    expect(dialog.className).not.toContain('static');
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.detach).not.toHaveBeenCalled();
    expect(
      screen.getByRole('heading', { name: 'Visa terminada en 4242' })
    ).toBeTruthy();
  });

  it('keeps the card when the person changes their mind', async () => {
    listing([VISA]);
    renderCards();
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Eliminar tarjeta: Visa terminada en 4242',
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
        name: 'Eliminar tarjeta: Visa terminada en 4242',
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
        name: 'Eliminar tarjeta: Visa terminada en 4242',
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
      name: 'Eliminar tarjeta: Visa terminada en 4242',
    });
    expect(remove.className).toContain('tap-target');
    expect(
      screen.getByRole('button', { name: 'Reemplazar tarjeta' }).className
    ).toContain('tap-target');
    fireEvent.click(remove);
    for (const name of ['Sí, eliminar', 'Conservar']) {
      expect(screen.getByRole('button', { name }).className).toContain(
        'tap-target'
      );
    }
  });
});
