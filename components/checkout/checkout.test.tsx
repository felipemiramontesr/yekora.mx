// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages, type Locale } from '@/app/i18n';
import type { AddressView } from '@/lib/account/addressTypes';
import { listAddresses } from '@/lib/api/accountDataClient';
import type { QuoteState } from '@/lib/api/cartClient';
import { fetchOrder, submitCheckout } from '@/lib/api/checkoutClient';
import { getCartStore } from '@/lib/cart/cartStore';
import type { CartQuote } from '@/lib/cart/cartTypes';
import { getDestinationStore } from '@/lib/cart/destinationStore';
import type { OrderView } from '@/lib/checkout/checkoutTypes';
import { recallOrder, rememberOrder } from '@/lib/checkout/orderAccess';
import { CartContents } from '../cart/CartContents';
import { useCartQuote } from '../cart/useCart';
import { useHeaderAccount } from '../useHeaderAccount';
import { CheckoutForm } from './CheckoutForm';
import { OrderStatus } from './OrderStatus';

vi.mock('@/lib/api/checkoutClient', () => ({
  submitCheckout: vi.fn(),
  fetchOrder: vi.fn(),
}));
// The live quote is the cart's (tested in cart.test.tsx); here each test sets the one it needs.
vi.mock('../cart/useCart', async (original) => ({
  ...(await original<typeof import('../cart/useCart')>()),
  useCartQuote: vi.fn(),
}));

// FC 051: the account of the header and its saved addresses are what each test sets; a guest by default.
vi.mock('../useHeaderAccount', () => ({ useHeaderAccount: vi.fn() }));
vi.mock('@/lib/api/accountDataClient', () => ({ listAddresses: vi.fn() }));

const submit = vi.mocked(submitCheckout);
const account = vi.mocked(useHeaderAccount);
const savedBook = vi.mocked(listAddresses);
const readOrder = vi.mocked(fetchOrder);
const liveQuote = vi.mocked(useCartQuote);

const QUOTE = {
  items: [],
  summary: {
    itemsBaseMxnCents: 159483,
    itemsTaxMxnCents: 25517,
    itemsTotalMxnCents: 185000,
    shippingCode: 'STANDARD_RATE',
    shippingBaseMxnCents: 12931,
    shippingTaxMxnCents: 2069,
    shippingTotalMxnCents: 15000,
    serviceable: true,
    freeShippingRemainingMxnCents: null,
    subtotalMxnCents: 172414,
    taxMxnCents: 27586,
    totalMxnCents: 200000,
    totalItems: 1,
    referenceUsdCents: null,
    exchangeRate: null,
  },
  warnings: [],
} as unknown as CartQuote;

const READY: QuoteState = {
  status: 'ready',
  quote: QUOTE,
  error: null,
  shippingIssue: null,
};

const SESSION = {
  orderNumber: 'YEK-2026-AB12CD34',
  accessToken: 'a'.repeat(43),
  redirectUrl: 'https://checkout.stripe.com/c/pay/cs_test_1',
  expiresAt: '2026-10-21T20:00:00.000Z',
  totalMxnCents: 200000,
};

const assign = vi.fn();

function messagesOf(locale: Locale) {
  const all = getMessages(locale);
  return { checkout: all.checkout, cart: all.cart, price: all.catalog.price };
}

function renderForm(locale: Locale = 'es-MX') {
  const m = messagesOf(locale);
  return render(
    <CheckoutForm
      locale={locale}
      messages={m.checkout}
      cartMessages={m.cart}
      priceMessages={m.price}
    />
  );
}

/** Types a complete, valid buyer into the Spanish form. */
function fillForm() {
  const type = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  type('Nombre completo', 'Ana Flores');
  type('Correo electrónico', 'ana@example.com');
  type('Teléfono', '4929421780');
  type('Calle', 'Av. Barones');
  type('Número exterior', '209');
  type('Colonia', 'Las Américas');
  type('Municipio o alcaldía', 'Guadalupe');
  type('Código postal', '98612');
  fireEvent.click(screen.getByLabelText(/Efectivo en OXXO/));
  fireEvent.click(screen.getByRole('checkbox'));
}

const payButton = () => screen.getByRole('button', { name: /Ir a pagar/ });

beforeEach(() => {
  vi.stubGlobal('location', { assign });
  liveQuote.mockReturnValue(READY);
  getCartStore().addItem('TENT', 1);
  getDestinationStore().setState('ZAC');
  account.mockReturnValue({ firstName: null, user: null });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  getCartStore().clearCart();
  getDestinationStore().setState(null);
  sessionStorage.clear();
});

describe('CheckoutForm with nothing to buy (FC 062 T1.1, T2.1)', () => {
  it('shows the useful state with its two links, never the form with $0.00', () => {
    liveQuote.mockReturnValue({
      status: 'ready',
      quote: {
        ...QUOTE,
        items: [{ sku: 'TENT', purchasable: false }],
      } as unknown as CartQuote,
      error: null,
      shippingIssue: null,
    });
    const { container } = renderForm();
    const { unavailable } = getMessages('es-MX').checkout;
    expect(screen.getByText(unavailable.title)).toBeTruthy();
    expect(screen.getByText(unavailable.text)).toBeTruthy();
    expect(
      screen.getByRole('link', { name: unavailable.cart }).getAttribute('href')
    ).toBe('/carrito/');
    expect(
      screen
        .getByRole('link', { name: unavailable.catalog })
        .getAttribute('href')
    ).toBe('/catalogo/');
    expect(container.querySelector('form')).toBeNull();
    expect(screen.queryByRole('button', { name: /Ir a pagar/ })).toBeNull();
  });
});

describe('CheckoutForm', () => {
  it('pays: validates, opens the session, keeps the access in this tab and goes to the processor', async () => {
    submit.mockResolvedValue({ ok: true, session: SESSION });
    renderForm();
    fillForm();
    expect(payButton().textContent).toContain('2,000.00');
    fireEvent.click(payButton());
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(SESSION.redirectUrl)
    );
    expect(submit).toHaveBeenCalledWith(
      {
        items: [{ sku: 'TENT', quantity: 1 }],
        method: 'OXXO',
        customer: {
          name: 'Ana Flores',
          email: 'ana@example.com',
          phone: '4929421780',
        },
        address: {
          street: 'Av. Barones',
          exteriorNumber: '209',
          neighborhood: 'Las Américas',
          municipality: 'Guadalupe',
          stateCode: 'ZAC',
          postalCode: '98612',
        },
        privacyConsent: true,
        expectedTotalMxnCents: 200000,
      },
      'es-MX'
    );
    expect(recallOrder()).toEqual({
      orderNumber: SESSION.orderNumber,
      accessToken: SESSION.accessToken,
      redirectUrl: SESSION.redirectUrl,
    });
    expect(screen.getByText('Preparando tu pago seguro…')).toBeTruthy();
    // First test of the file: it pays the cold start of jsdom and React, slow on a busy machine.
  }, 15_000);

  it('shows every missing field, marks it invalid and focuses the first one', () => {
    renderForm();
    fireEvent.click(payButton());
    // The summary alert stays, first, besides the alert of each field (FC 050 T2.3).
    expect(screen.getAllByRole('alert')[0].textContent).toBe(
      'Revisa los campos marcados.'
    );
    const name = screen.getByLabelText('Nombre completo');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(name);
    expect(screen.getByText('Escribe tu teléfono a 10 dígitos.')).toBeTruthy();
    expect(screen.getByText('Elige cómo quieres pagar.')).toBeTruthy();
    expect(
      screen.getByText(
        'Para continuar, acepta el Aviso de privacidad y los Términos y condiciones.'
      )
    ).toBeTruthy();
    expect(submit).not.toHaveBeenCalled();
  });

  it('guides every field with how to fill it in and its simplest example, tied to the control (FC 050 T1.1, T2.3)', () => {
    renderForm();
    const { contact, address, fields } = messagesOf('es-MX').checkout;
    const guided = [
      [contact.name, fields.name],
      [contact.email, fields.email],
      [contact.phone, fields.phone],
      [address.street, fields.street],
      [address.exteriorNumber, fields.exteriorNumber],
      [address.interiorNumber, fields.interiorNumber],
      [address.neighborhood, fields.neighborhood],
      [address.municipality, fields.municipality],
      [address.postalCode, fields.postalCode],
      [address.references, fields.references],
      [address.state, fields.stateCode],
    ] as const;
    for (const [label, field] of guided) {
      const control = screen.getByLabelText(label);
      expect(control.getAttribute('aria-describedby')).toBe(
        `${control.id}-hint`
      );
      expect(document.getElementById(`${control.id}-hint`)?.textContent).toBe(
        `${field.description} ${fields.exampleLabel}: ${field.example}`
      );
    }
    // A refused field points at its hint and its error, and the hint stays (T1.1 E).
    fireEvent.click(payButton());
    const name = screen.getByLabelText(contact.name);
    expect(name.getAttribute('aria-describedby')).toBe(
      `${name.id}-hint ${name.id}-error`
    );
    expect(document.getElementById(`${name.id}-hint`)).not.toBeNull();
  });

  it('focuses the payment methods when only the method is missing', () => {
    renderForm();
    fillForm();
    // Unchoose by re-rendering from scratch with everything but the method.
    cleanup();
    renderForm();
    const type = (label: string, value: string) =>
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    type('Nombre completo', 'Ana Flores');
    type('Correo electrónico', 'ana@example.com');
    type('Teléfono', '4929421780');
    type('Calle', 'Av. Barones');
    type('Número exterior', '209');
    type('Colonia', 'Las Américas');
    type('Municipio o alcaldía', 'Guadalupe');
    type('Código postal', '98612');
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(payButton());
    expect(document.activeElement).toBe(
      screen.getByLabelText(/Tarjeta de crédito o débito/)
    );
  });

  it("asks for the state in the address, sharing the cart's remembered state", () => {
    getDestinationStore().setState(null);
    renderForm();
    expect(payButton().hasAttribute('disabled')).toBe(true);
    expect(
      screen.getByText(
        'Elige un estado al que enviemos para calcular el total.'
      )
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Estado'), {
      target: { value: 'JAL' },
    });
    expect(getDestinationStore().getSnapshot()).toBe('JAL');
    expect(liveQuote).toHaveBeenLastCalledWith(
      [{ sku: 'TENT', quantity: 1 }],
      'es-MX',
      'JAL',
      0
    );
  });

  it('marks a missing state on the select', () => {
    getDestinationStore().setState(null);
    renderForm();
    fillForm();
    fireEvent.submit(payButton().closest('form') as HTMLFormElement);
    const state = screen.getByLabelText('Estado');
    expect(state.getAttribute('aria-invalid')).toBe('true');
    // The select keeps its hint beside its error (FC 050 T1.1 E).
    expect(state.getAttribute('aria-describedby')).toBe(
      `${state.id}-hint ${state.id}-error`
    );
    expect(screen.getByText('Elige tu estado.')).toBeTruthy();
  });

  it('keeps pay disabled before the first quote arrives', () => {
    liveQuote.mockReturnValue({
      status: 'loading',
      quote: null,
      error: null,
      shippingIssue: null,
    });
    renderForm();
    expect(payButton().hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Calculando el total de tu mochila…')).toBeTruthy();
  });

  it('does not send a valid form while the total is not confirmed', () => {
    liveQuote.mockReturnValue({ ...READY, status: 'loading' });
    renderForm();
    fillForm();
    fireEvent.submit(payButton().closest('form') as HTMLFormElement);
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByText('Calculando el total de tu mochila…')).toBeTruthy();
  });

  it.each([
    [
      'PRICE_CHANGED',
      'Los precios o el envío cambiaron. Revisa el nuevo total antes de pagar.',
      1,
    ],
    [
      'INSUFFICIENT_STOCK',
      'Alguien acaba de llevarse una de tus piezas. Revisa tu mochila.',
      1,
    ],
    [
      'SERVICE_UNAVAILABLE',
      'Los pagos no están disponibles en este momento. Intenta de nuevo en unos minutos.',
      0,
    ],
    ['offline', 'Sin conexión. Revisa tu internet e intenta de nuevo.', 0],
  ] as const)(
    'explains %s and re-quotes when the total is stale',
    async (reason, text, revision) => {
      submit.mockResolvedValue({ ok: false, reason });
      renderForm();
      fillForm();
      fireEvent.click(payButton());
      await screen.findByText(text);
      expect(liveQuote).toHaveBeenLastCalledWith(
        expect.anything(),
        'es-MX',
        'ZAC',
        revision
      );
      expect(assign).not.toHaveBeenCalled();
    }
  );

  it('never navigates to a page that is not Stripe or Mercado Pago', async () => {
    submit.mockResolvedValue({
      ok: true,
      session: { ...SESSION, redirectUrl: 'https://evil.example/pay' },
    });
    renderForm();
    fillForm();
    fireEvent.click(payButton());
    await screen.findByText('No pudimos iniciar tu pago. Intenta de nuevo.');
    expect(assign).not.toHaveBeenCalled();
    expect(recallOrder()).toBeNull();
  });

  it('sends a buyer with an empty pack to the catalog', () => {
    getCartStore().clearCart();
    renderForm('en');
    expect(screen.getByText('Your pack is empty')).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'Browse the catalog' })
        .getAttribute('href')
    ).toBe('/en/catalog/');
  });

  it('links the consent to the privacy notice and terms in a new tab, unchecked', () => {
    renderForm('en');
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(
      false
    );
    for (const [name, href] of [
      ['Privacy notice', '/en/privacy/'],
      ['Terms and conditions', '/en/terms/'],
    ]) {
      const link = screen.getByRole('link', { name });
      expect(link.getAttribute('href')).toBe(href);
      expect(link.getAttribute('target')).toBe('_blank');
    }
    expect(
      screen
        .getAllByRole('radio')
        .every((r) => !(r as HTMLInputElement).checked)
    ).toBe(true);
  });
});

describe('the cart leads to the checkout', () => {
  it('shows «Continuar al pago» under the summary', () => {
    const { cart, catalog } = getMessages('es-MX');
    render(
      <CartContents
        locale="es-MX"
        messages={cart}
        priceMessages={catalog.price}
      />
    );
    expect(
      screen
        .getByRole('link', { name: 'Continuar al pago' })
        .getAttribute('href')
    ).toBe('/checkout/');
  });
});

const ORDER: OrderView = {
  orderNumber: 'YEK-2026-AB12CD34',
  status: 'PENDING_PAYMENT',
  method: 'CARD',
  itemsTotalMxnCents: 185000,
  shippingTotalMxnCents: 15000,
  totalMxnCents: 200000,
  expiresAt: '2026-10-24T19:00:00.000Z',
  paidAt: null,
};

function renderStatus(variant: 'success' | 'cancel', locale: Locale = 'es-MX') {
  return render(
    <OrderStatus
      locale={locale}
      variant={variant}
      messages={getMessages(locale).checkout}
    />
  );
}

describe('OrderStatus (return pages)', () => {
  beforeEach(() => {
    rememberOrder({
      orderNumber: SESSION.orderNumber,
      accessToken: SESSION.accessToken,
      redirectUrl: SESSION.redirectUrl,
    });
  });

  it('says so when this tab placed no order', async () => {
    sessionStorage.clear();
    renderStatus('success');
    await screen.findByText(
      'No encontramos un pedido reciente en esta pestaña del navegador.'
    );
    expect(readOrder).not.toHaveBeenCalled();
    expect(
      screen
        .getByRole('link', { name: 'Seguir explorando' })
        .getAttribute('href')
    ).toBe('/catalogo/');
  });

  it('shows a paid order with its amounts, and empties the cart', async () => {
    readOrder.mockResolvedValue({
      ok: true,
      order: { ...ORDER, status: 'PAID' },
    });
    renderStatus('success');
    await screen.findByText(
      '¡Pago confirmado! Ya estamos preparando tu pedido para enviarlo.'
    );
    expect(readOrder).toHaveBeenCalledWith({
      orderNumber: SESSION.orderNumber,
      accessToken: SESSION.accessToken,
      redirectUrl: SESSION.redirectUrl,
    });
    expect(screen.getByText('Pedido YEK-2026-AB12CD34')).toBeTruthy();
    expect(screen.getByText('Tarjeta de crédito o débito')).toBeTruthy();
    expect(screen.getByText(/2,000\.00/)).toBeTruthy();
    // The cart is emptied by a passive effect, which can flush after the text is already on
    // screen: wait for it instead of reading the store once (the CI flake of FC 012 F5).
    await waitFor(() => expect(getCartStore().getSnapshot()).toEqual([]));
    expect(
      screen.queryByRole('button', { name: 'Volver a la página de pago' })
    ).toBeNull();
  });

  // Polling runs on fake timers only, advanced inside act: no real clock can slip in, so the
  // count of requests is exact however loaded the machine is.
  const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

  it('after a card, asks again every 4 s until the payment is settled', async () => {
    vi.useFakeTimers();
    readOrder
      .mockResolvedValueOnce({ ok: true, order: ORDER })
      .mockResolvedValueOnce({ ok: true, order: { ...ORDER, status: 'PAID' } });
    renderStatus('success');
    await tick(0);
    expect(
      screen.getByText(
        'Esta página se actualiza sola en cuanto el procesador confirme el pago.'
      )
    ).toBeTruthy();
    expect(getCartStore().getSnapshot()).toEqual([]);
    await tick(3999);
    expect(readOrder).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(
      screen.getByText(
        '¡Pago confirmado! Ya estamos preparando tu pedido para enviarlo.'
      )
    ).toBeTruthy();
    expect(readOrder).toHaveBeenCalledTimes(2);
  });

  it('stops asking after a minute and shows the deadline instead', async () => {
    vi.useFakeTimers();
    readOrder.mockResolvedValue({ ok: true, order: ORDER });
    renderStatus('success');
    await tick(0);
    for (let poll = 0; poll < 15; poll += 1) await tick(4000);
    expect(screen.getByText(/Completa tu pago antes del/)).toBeTruthy();
    await tick(60_000);
    expect(readOrder).toHaveBeenCalledTimes(16);
  });

  it('after OXXO, shows the deadline in Mexico City time and a way back to the slip', async () => {
    readOrder.mockResolvedValue({
      ok: true,
      order: { ...ORDER, method: 'OXXO' },
    });
    renderStatus('success', 'en');
    await screen.findByText(
      /Complete your payment before October 24, 2026 at 1:00/
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Back to the payment page' })
    );
    expect(assign).toHaveBeenCalledWith(SESSION.redirectUrl);
  });

  it('back from the cancel page, an unpaid order offers the same payment page and keeps the cart', async () => {
    readOrder.mockResolvedValue({ ok: true, order: ORDER });
    renderStatus('cancel');
    await screen.findByText(/Completa tu pago antes del/);
    expect(
      screen.queryByText('Estamos esperando la confirmación de tu pago.')
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Volver a la página de pago' })
    ).toBeTruthy();
    expect(getCartStore().getSnapshot()).toEqual([
      { sku: 'TENT', quantity: 1 },
    ]);
  });

  it('never offers a stored payment page that is not Stripe or Mercado Pago', async () => {
    rememberOrder({
      orderNumber: SESSION.orderNumber,
      accessToken: SESSION.accessToken,
      redirectUrl: 'https://evil.example/pay',
    });
    readOrder.mockResolvedValue({ ok: true, order: ORDER });
    renderStatus('cancel');
    await screen.findByText(/Completa tu pago antes del/);
    expect(
      screen.queryByRole('button', { name: 'Volver a la página de pago' })
    ).toBeNull();
  });

  it.each([
    [
      'EXPIRED',
      'El plazo para pagar este pedido terminó y liberamos los productos. No se hizo ningún cargo.',
    ],
    ['CANCELLED', 'Este pedido se canceló. No se hizo ningún cargo.'],
    ['REFUNDED', 'Este pedido fue reembolsado.'],
    [
      'NEEDS_REVIEW',
      'Recibimos un pago que estamos revisando. Nos pondremos en contacto contigo.',
    ],
  ] as const)(
    'explains a %s order and keeps the cart',
    async (status, text) => {
      readOrder.mockResolvedValue({ ok: true, order: { ...ORDER, status } });
      renderStatus('success');
      await screen.findByText(text);
      expect(getCartStore().getSnapshot()).toHaveLength(1);
    }
  );

  it('offers to ask again when the order cannot be read', async () => {
    readOrder
      .mockResolvedValueOnce({ ok: false, reason: 'offline' })
      .mockResolvedValueOnce({ ok: true, order: { ...ORDER, status: 'PAID' } });
    renderStatus('success');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Consultar de nuevo' })
    );
    expect(
      await screen.findByText(
        '¡Pago confirmado! Ya estamos preparando tu pedido para enviarlo.'
      )
    ).toBeTruthy();
    expect(readOrder).toHaveBeenCalledTimes(2);
  });

  it('ignores an answer that arrives after the page is gone', async () => {
    let answer: (value: Awaited<ReturnType<typeof fetchOrder>>) => void;
    readOrder.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      })
    );
    const { unmount } = renderStatus('success');
    expect(screen.getByText('Consultando tu pedido…')).toBeTruthy();
    unmount();
    await act(async () => {
      answer({ ok: true, order: ORDER });
    });
    expect(getCartStore().getSnapshot()).toHaveLength(1);
  });
});

describe('CheckoutForm of a signed-in buyer (FC 051 T1.4, T2.5, T2.6)', () => {
  const ANA = {
    id: 'f0000000-0000-4000-8000-000000000001',
    email: 'ana@example.test',
    fullName: 'Ana Pérez',
    roles: ['customer'],
    permissions: ['account:self'],
    phone: '4929421780',
    postalCode: '98612',
    stateCode: 'ZAC',
  };
  const address = (over: Partial<AddressView> = {}): AddressView => ({
    id: 'a0000000-0000-4000-8000-000000000001',
    isDefault: true,
    isComplete: true,
    stateCode: 'ZAC',
    postalCode: '98612',
    label: 'Casa',
    name: 'Ana Pérez',
    phone: '4929421780',
    street: 'Av. Barones',
    exteriorNumber: '209',
    interiorNumber: null,
    neighborhood: 'Las Américas',
    municipality: 'Guadalupe',
    references: null,
    ...over,
  });
  const OFICINA = address({
    id: 'a0000000-0000-4000-8000-000000000002',
    isDefault: false,
    label: 'Oficina',
    street: 'Calle Hidalgo',
    exteriorNumber: '12',
    neighborhood: 'Centro',
    municipality: 'Zacatecas',
    postalCode: '98000',
  });
  const INCOMPLETE = address({
    id: 'a0000000-0000-4000-8000-000000000003',
    isDefault: false,
    isComplete: false,
    label: 'Sin completar',
    street: null,
  });
  const signedIn = (items: AddressView[], max = 5) => {
    account.mockReturnValue({ firstName: 'Ana', user: ANA });
    savedBook.mockResolvedValue({ ok: true, data: { items, max } });
  };
  const field = (label: string) =>
    screen.getByLabelText(label) as HTMLInputElement;
  const pay = async () => {
    fireEvent.click(screen.getByLabelText(/Efectivo en OXXO/));
    fireEvent.click(screen.getByRole('checkbox', { name: /privacidad/i }));
    submit.mockResolvedValue({ ok: true, session: SESSION });
    fireEvent.click(payButton());
    await waitFor(() => expect(submit).toHaveBeenCalled());
    return submit.mock.calls[0][0];
  };

  it('starts with the contact of the account and the default saved address chosen and filled in', async () => {
    signedIn([address(), OFICINA, INCOMPLETE]);
    renderForm();
    expect(await screen.findByLabelText(/Casa/)).toHaveProperty(
      'checked',
      true
    );
    expect(field('Nombre completo').value).toBe('Ana Pérez');
    expect(field('Correo electrónico').value).toBe('ana@example.test');
    expect(field('Teléfono').value).toBe('4929421780');
    expect(field('Calle').value).toBe('Av. Barones');
    expect(field('Código postal').value).toBe('98612');
    // Only the addresses that can ship an order are offered, the default one marked.
    expect(screen.getByText(/Casa · Predeterminado/)).toBeTruthy();
    expect(screen.getByLabelText(/Oficina/)).toBeTruthy();
    expect(screen.queryByLabelText(/Sin completar/)).toBeNull();
    expect(
      screen
        .getByRole('link', { name: 'Administrar mis domicilios' })
        .getAttribute('href')
    ).toBe('/cuenta/datos/');
    expect(screen.queryByLabelText(/Guardar este domicilio/)).toBeNull();
  });

  it('fills the form and the delivery state with another saved address, and sends no request to keep it', async () => {
    signedIn([address(), OFICINA]);
    renderForm();
    await screen.findByLabelText(/Casa/);
    fireEvent.click(screen.getByLabelText(/Oficina/));
    expect(field('Calle').value).toBe('Calle Hidalgo');
    expect(field('Colonia').value).toBe('Centro');
    expect(field('Código postal').value).toBe('98000');
    const request = await pay();
    expect(request).toMatchObject({
      address: {
        street: 'Calle Hidalgo',
        postalCode: '98000',
        stateCode: 'ZAC',
      },
      customer: { name: 'Ana Pérez', email: 'ana@example.test' },
    });
    expect(request.saveAddress).toBeUndefined();
  });

  it('clears the address fields for «use another address», offers to keep it, and asks the API to', async () => {
    signedIn([address()]);
    renderForm();
    await screen.findByLabelText(/Casa/);
    fireEvent.click(screen.getByLabelText('Usar otro domicilio'));
    expect(field('Calle').value).toBe('');
    expect(field('Código postal').value).toBe('');
    fireEvent.change(field('Calle'), { target: { value: 'Av. Nueva' } });
    fireEvent.change(field('Número exterior'), { target: { value: '7' } });
    fireEvent.change(field('Colonia'), { target: { value: 'Centro' } });
    fireEvent.change(field('Municipio o alcaldía'), {
      target: { value: 'Zacatecas' },
    });
    fireEvent.change(field('Código postal'), { target: { value: '98000' } });
    fireEvent.click(screen.getByLabelText(/Guardar este domicilio/));
    const request = await pay();
    expect(request).toMatchObject({
      saveAddress: true,
      address: { street: 'Av. Nueva', postalCode: '98000' },
    });
  });

  it('offers to keep the address of a buyer with an empty book, and not when the book is full', async () => {
    signedIn([]);
    renderForm();
    expect(await screen.findByLabelText(/Guardar este domicilio/)).toBeTruthy();
    expect(screen.queryByLabelText('Usar otro domicilio')).toBeNull();
    cleanup();
    const full = Array.from({ length: 5 }, (_, n) =>
      address({
        id: `a0000000-0000-4000-8000-00000000010${n}`,
        isDefault: n === 0,
      })
    );
    signedIn(full);
    renderForm();
    await screen.findByLabelText('Usar otro domicilio');
    fireEvent.click(screen.getByLabelText('Usar otro domicilio'));
    expect(screen.queryByLabelText(/Guardar este domicilio/)).toBeNull();
  });

  it('keeps what the buyer typed before the account answered, and works as a guest when the book fails', async () => {
    account.mockReturnValue({ firstName: 'Ana', user: ANA });
    savedBook.mockResolvedValue({ ok: false, reason: 'offline' });
    renderForm();
    await waitFor(() => expect(savedBook).toHaveBeenCalled());
    expect(field('Nombre completo').value).toBe('Ana Pérez');
    expect(screen.queryByLabelText('Usar otro domicilio')).toBeNull();
    expect(screen.queryByLabelText(/Guardar este domicilio/)).toBeNull();
    fireEvent.change(field('Nombre completo'), {
      target: { value: 'Otra Persona' },
    });
    expect(field('Nombre completo').value).toBe('Otra Persona');
  });

  it('offers an address without a name by its street, and starts without a phone when the account has none', async () => {
    account.mockReturnValue({
      firstName: 'Ana',
      user: { ...ANA, phone: null },
    });
    savedBook.mockResolvedValue({
      ok: true,
      data: { items: [address({ label: null })], max: 5 },
    });
    renderForm();
    expect(
      await screen.findByText(/Av\. Barones · Predeterminado/)
    ).toBeTruthy();
    expect(field('Teléfono').value).toBe('');
  });

  it('asks the API for nothing when there is no account', () => {
    renderForm();
    expect(savedBook).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/Guardar este domicilio/)).toBeNull();
  });
});

describe('keeping the card for next time (FC 054 T1.3)', () => {
  const ANA = {
    id: 'f0000000-0000-4000-8000-000000000001',
    email: 'ana@example.test',
    fullName: 'Ana Pérez',
    roles: ['customer'],
    permissions: ['account:self'],
    phone: '4929421780',
    postalCode: '98612',
    stateCode: 'ZAC',
  };
  const HOME: AddressView = {
    id: 'a0000000-0000-4000-8000-000000000001',
    isDefault: true,
    isComplete: true,
    stateCode: 'ZAC',
    postalCode: '98612',
    label: 'Casa',
    name: 'Ana Pérez',
    phone: '4929421780',
    street: 'Av. Barones',
    exteriorNumber: '209',
    interiorNumber: null,
    neighborhood: 'Las Américas',
    municipality: 'Guadalupe',
    references: null,
  };
  const KEEP = /Guardar esta tarjeta en mi cuenta/;
  const payWithCard = async (keepIt: boolean) => {
    fireEvent.click(screen.getByLabelText(/Tarjeta de crédito o débito/));
    if (keepIt) fireEvent.click(screen.getByLabelText(KEEP));
    fireEvent.click(screen.getByRole('checkbox', { name: /privacidad/i }));
    submit.mockResolvedValue({ ok: true, session: SESSION });
    fireEvent.click(payButton());
    await waitFor(() => expect(submit).toHaveBeenCalled());
    return submit.mock.calls[0][0];
  };
  const signedInBuyer = () => {
    account.mockReturnValue({ firstName: 'Ana', user: ANA });
    savedBook.mockResolvedValue({ ok: true, data: { items: [HOME], max: 5 } });
  };

  it('offers it only to a signed-in buyer who chose the card, and says Stripe keeps it', async () => {
    signedInBuyer();
    renderForm();
    await screen.findByLabelText(/Casa/);
    // Another method keeps nothing: there is no card to keep.
    expect(screen.queryByLabelText(KEEP)).toBeNull();
    fireEvent.click(screen.getByLabelText(/Efectivo en OXXO/));
    expect(screen.queryByLabelText(KEEP)).toBeNull();
    fireEvent.click(screen.getByLabelText(/Tarjeta de crédito o débito/));
    expect(screen.getByLabelText(KEEP)).toHaveProperty('checked', false);
    expect(screen.getByText(/La guarda Stripe, no YĒKORA/)).toBeTruthy();
  });

  it('never offers it to a guest', () => {
    account.mockReturnValue({ firstName: null, user: null });
    renderForm();
    fireEvent.click(screen.getByLabelText(/Tarjeta de crédito o débito/));
    expect(screen.queryByLabelText(KEEP)).toBeNull();
  });

  it('asks the API to keep the card only when the buyer ticked the box', async () => {
    signedInBuyer();
    renderForm();
    await screen.findByLabelText(/Casa/);
    const kept = await payWithCard(true);
    expect(kept).toMatchObject({ method: 'CARD', savePaymentMethod: true });
    cleanup();
    submit.mockClear();
    signedInBuyer();
    renderForm();
    await screen.findByLabelText(/Casa/);
    const notKept = await payWithCard(false);
    expect(notKept.savePaymentMethod).toBeUndefined();
  });

  it('does not send the wish when the buyer ticked it and then chose another method', async () => {
    signedInBuyer();
    renderForm();
    await screen.findByLabelText(/Casa/);
    fireEvent.click(screen.getByLabelText(/Tarjeta de crédito o débito/));
    fireEvent.click(screen.getByLabelText(KEEP));
    fireEvent.click(screen.getByLabelText(/Efectivo en OXXO/));
    fireEvent.click(screen.getByRole('checkbox', { name: /privacidad/i }));
    submit.mockResolvedValue({ ok: true, session: SESSION });
    fireEvent.click(payButton());
    await waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit.mock.calls[0][0].savePaymentMethod).toBeUndefined();
  });
});
