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
import type { QuoteState } from '@/lib/api/cartClient';
import { fetchOrder, submitCheckout } from '@/lib/api/checkoutClient';
import { getCartStore } from '@/lib/cart/cartStore';
import type { CartQuote } from '@/lib/cart/cartTypes';
import { getDestinationStore } from '@/lib/cart/destinationStore';
import type { OrderView } from '@/lib/checkout/checkoutTypes';
import { recallOrder, rememberOrder } from '@/lib/checkout/orderAccess';
import { CartContents } from '../cart/CartContents';
import { useCartQuote } from '../cart/useCart';
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

const submit = vi.mocked(submitCheckout);
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
  });

  it('shows every missing field, marks it invalid and focuses the first one', () => {
    renderForm();
    fireEvent.click(payButton());
    expect(screen.getByRole('alert').textContent).toBe(
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
    expect(screen.getByLabelText('Estado').getAttribute('aria-invalid')).toBe(
      'true'
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
