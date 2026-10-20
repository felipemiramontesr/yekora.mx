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
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { getMessages, type Locale } from '@/app/i18n';
import type { QuoteState } from '@/lib/api/cartClient';
import { getCartStore } from '@/lib/cart/cartStore';
import { getDestinationStore } from '@/lib/cart/destinationStore';
import type { CartQuote } from '@/lib/cart/cartTypes';
import { AddToCartButton } from './AddToCartButton';
import { CartButton } from './CartButton';
import { CartSummary } from './CartSummary';

const FIX = { series: 'SF43718', date: '2026-10-16', rate: '18.5000' };
const NAMES: Record<string, string> = { TENT: 'Tienda', PACK: 'Mochila' };

type Item = CartQuote['items'][number];

function stockStatusOf(stock: number): Item['stockStatus'] {
  if (stock === 0) return 'out_of_stock';
  return stock < 5 ? 'low_stock' : 'available';
}

/** Answers like the API: net 1 160 per unit; PACK has 2 left, LAST 1, ZERO none; GONE does not exist. */
function quoteOf(items: { sku: string; quantity: number }[]): CartQuote {
  let subtotal = 0;
  let tax = 0;
  let total = 0;
  let units = 0;
  const warnings: CartQuote['warnings'] = [];
  const lines: Item[] = items.map(({ sku, quantity }) => {
    if (sku === 'GONE') {
      warnings.push({ sku, code: 'unavailable' });
      return {
        sku,
        slug: null,
        name: null,
        quantity,
        unitPriceMxnCents: null,
        lineTotalMxnCents: null,
        lineBaseMxnCents: null,
        lineTaxMxnCents: null,
        stockStatus: 'unavailable',
        availableQuantity: 0,
        purchasable: false,
      };
    }
    const stock = { PACK: 2, LAST: 1, ZERO: 0 }[sku] ?? 10;
    const lineTotal = 1160 * quantity;
    const base = Math.round((lineTotal * 100) / 116);
    const purchasable = stock >= quantity;
    if (stock === 0) warnings.push({ sku, code: 'out_of_stock' });
    else if (!purchasable) warnings.push({ sku, code: 'insufficient_stock' });
    if (purchasable) {
      subtotal += base;
      tax += lineTotal - base;
      total += lineTotal;
      units += quantity;
    }
    return {
      sku,
      slug: sku.toLowerCase(),
      name: NAMES[sku] ?? sku,
      quantity,
      unitPriceMxnCents: 1160,
      lineTotalMxnCents: lineTotal,
      lineBaseMxnCents: base,
      lineTaxMxnCents: lineTotal - base,
      stockStatus: stockStatusOf(stock),
      availableQuantity: stock,
      purchasable,
    };
  });
  return {
    items: lines,
    summary: {
      itemsBaseMxnCents: subtotal,
      itemsTaxMxnCents: tax,
      itemsTotalMxnCents: total,
      shippingCode: null,
      shippingBaseMxnCents: null,
      shippingTaxMxnCents: null,
      shippingTotalMxnCents: null,
      serviceable: true,
      freeShippingRemainingMxnCents: null,
      subtotalMxnCents: subtotal,
      taxMxnCents: tax,
      totalMxnCents: total,
      totalItems: units,
      referenceUsdCents: total > 0 ? Math.round(total / 18.5) : null,
      exchangeRate: FIX,
    },
    warnings,
  };
}

/** Renders the summary alone with a given quote state and delivery state. */
function renderSummary(
  state: QuoteState,
  locale: Locale = 'es-MX',
  stateCode: string | null = null
) {
  return render(
    <CartSummary
      locale={locale}
      state={state}
      stateCode={stateCode}
      onStateChange={() => undefined}
      messages={getMessages(locale).cart}
      priceMessages={getMessages(locale).catalog.price}
    />
  );
}

function apiAnswering() {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const { items } = JSON.parse(String(init.body)) as {
      items: { sku: string; quantity: number }[];
    };
    return new Response(JSON.stringify(quoteOf(items)), { status: 200 });
  });
}

function showButton(locale: Locale = 'es-MX') {
  const messages = getMessages(locale);
  render(
    <CartButton
      locale={locale}
      messages={messages.cart}
      priceMessages={messages.catalog.price}
    />
  );
}

const cartLink = () => screen.getByRole('link', { name: /mochila|pack/i });
const panel = () => screen.getByRole('dialog', { hidden: true });

beforeAll(() => {
  // jsdom has no modal dialog; emulate the two methods the panel calls.
  HTMLDialogElement.prototype.showModal = function showModal(
    this: HTMLDialogElement
  ) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

beforeEach(() => {
  getCartStore().clearCart();
  getDestinationStore().setState(null);
  vi.stubGlobal('fetch', apiAnswering());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('cart button and panel', () => {
  it('shows 0 from launch and opens the branded empty pack (Ω decision)', () => {
    showButton();
    expect(cartLink().getAttribute('aria-label')).toBe(
      'Abrir tu mochila (0 productos)'
    );
    expect(cartLink().getAttribute('href')).toBe('/carrito/');
    fireEvent.click(cartLink());
    expect(panel().hasAttribute('open')).toBe(true);
    expect(within(panel()).getByText('Tu mochila está vacía')).toBeTruthy();
    expect(
      within(panel())
        .getByRole('link', { name: 'Ver catálogo' })
        .getAttribute('href')
    ).toBe('/catalogo/');
  });

  it('counts units and speaks the singular', () => {
    showButton('en');
    act(() => {
      getCartStore().addItem('TENT');
    });
    expect(cartLink().getAttribute('aria-label')).toBe(
      'Open your pack (1 product)'
    );
    act(() => {
      getCartStore().addItem('TENT', 2);
    });
    expect(within(cartLink()).getByRole('status').textContent).toBe('3');
  });

  it('closes with its button, with Esc and with a click on the backdrop', () => {
    showButton();
    fireEvent.click(cartLink());
    fireEvent.click(within(panel()).getByRole('button', { name: 'Cerrar' }));
    expect(panel().hasAttribute('open')).toBe(false);

    fireEvent.click(cartLink());
    act(() => {
      (panel() as HTMLDialogElement).close(); // what the browser does on Esc
    });
    expect(panel().hasAttribute('open')).toBe(false);

    fireEvent.click(cartLink());
    fireEvent.click(within(panel()).getByText('Tu mochila está vacía'));
    expect(panel().hasAttribute('open')).toBe(true);
    fireEvent.click(panel().querySelector('[data-cart-backdrop]') as Element);
    expect(panel().hasAttribute('open')).toBe(false);
  });

  it('opens when a product is added from the product page', () => {
    showButton();
    render(
      <AddToCartButton
        sku="TENT"
        inStock
        label="Agregar a la mochila"
        outOfStockLabel="Agotado"
      />
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Agregar a la mochila' })
    );
    expect(getCartStore().getSnapshot()).toEqual([
      { sku: 'TENT', quantity: 1 },
    ]);
    expect(panel().hasAttribute('open')).toBe(true);
  });

  it('does not let an out-of-stock product be added', () => {
    render(
      <AddToCartButton
        sku="SHOES"
        inStock={false}
        label="Agregar a la mochila"
        outOfStockLabel="Agotado"
      />
    );
    const button = screen.getByRole('button', {
      name: 'Agotado',
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});

describe('cart contents with a live quote', () => {
  it('lists each line with the quoted name, unit price and total, and the VAT breakdown', async () => {
    getCartStore().addItem('TENT', 3);
    showButton();
    fireEvent.click(cartLink());
    const view = within(panel());
    await waitFor(() => expect(view.getByText('Tienda')).toBeTruthy());
    expect(view.getByText('$11.60 MXN c/u')).toBeTruthy();
    // Line, products total with VAT (FC 011) and grand total: no shipping chosen yet.
    expect(view.getAllByText('$34.80 MXN')).toHaveLength(3);
    expect(view.getByText('$30.00 MXN')).toBeTruthy(); // subtotal before VAT
    expect(view.getByText('$4.80 MXN')).toBeTruthy(); // VAT
    expect(view.getByText('3 piezas')).toBeTruthy();
    expect(view.queryByText(/≈/)).toBeNull(); // pesos only in Spanish
    expect(view.getByText('Precios en pesos mexicanos (MXN).')).toBeTruthy();
    expect(
      view
        .getByRole('link', { name: 'Ver mochila completa' })
        .getAttribute('href')
    ).toBe('/carrito/');
  });

  it('adds the USD reference and its FIX in English', async () => {
    getCartStore().addItem('TENT');
    showButton('en');
    fireEvent.click(cartLink());
    const view = within(panel());
    await waitFor(() => expect(view.getByText('≈ $0.63 USD')).toBeTruthy());
    expect(view.getByText('1 item')).toBeTruthy();
    expect(
      view.getByText(/Banxico's FIX exchange rate of October 16, 2026/)
    ).toBeTruthy();
  });

  it('changes, types and removes quantities', async () => {
    getCartStore().addItem('TENT');
    showButton();
    fireEvent.click(cartLink());
    const view = within(panel());
    await waitFor(() => expect(view.getByText('Tienda')).toBeTruthy());
    const less = view.getByRole('button', {
      name: 'Quitar una unidad de Tienda',
    }) as HTMLButtonElement;
    expect(less.disabled).toBe(true);
    fireEvent.click(
      view.getByRole('button', { name: 'Agregar una unidad de Tienda' })
    );
    expect(getCartStore().getSnapshot()[0].quantity).toBe(2);
    fireEvent.click(less);
    expect(getCartStore().getSnapshot()[0].quantity).toBe(1);
    fireEvent.change(
      view.getByRole('spinbutton', { name: 'Cantidad de Tienda' }),
      {
        target: { value: '7' },
      }
    );
    expect(getCartStore().getSnapshot()[0].quantity).toBe(7);
    fireEvent.click(
      view.getByRole('button', { name: 'Quitar Tienda de la mochila' })
    );
    expect(view.getByText('Tu mochila está vacía')).toBeTruthy();
  });

  it('caps the plus button at 99', async () => {
    getCartStore().addItem('TENT', 99);
    showButton();
    fireEvent.click(cartLink());
    const plus = within(panel()).getByRole('button', {
      name: /Agregar una unidad de/,
    }) as HTMLButtonElement;
    expect(plus.disabled).toBe(true);
  });

  it('explains lines that cannot be bought and offers to adjust them', async () => {
    getCartStore().addItem('PACK', 3);
    getCartStore().addItem('GONE');
    showButton();
    fireEvent.click(cartLink());
    const view = within(panel());
    await waitFor(() =>
      expect(view.getByText('Solo quedan 2 piezas.')).toBeTruthy()
    );
    expect(view.getByText('Este producto ya no está disponible.')).toBeTruthy();
    expect(view.getByText('GONE')).toBeTruthy(); // no name without a product
    fireEvent.click(view.getByRole('button', { name: 'Ajustar a 2' }));
    expect(getCartStore().getSnapshot()[0]).toEqual({
      sku: 'PACK',
      quantity: 2,
    });
    await waitFor(() =>
      expect(view.queryByText('Solo quedan 2 piezas.')).toBeNull()
    );
  });
});

describe('an out-of-stock line', () => {
  it('says so and offers no adjustment', async () => {
    getCartStore().addItem('ZERO');
    showButton();
    fireEvent.click(cartLink());
    const view = within(panel());
    await waitFor(() =>
      expect(view.getByText('Agotado por ahora.')).toBeTruthy()
    );
    expect(view.queryByRole('button', { name: /Ajustar/ })).toBeNull();
  });
});

describe('the last unit', () => {
  it('speaks the singular and adjusts to 1', async () => {
    getCartStore().addItem('LAST', 2);
    showButton();
    fireEvent.click(cartLink());
    const view = within(panel());
    await waitFor(() =>
      expect(view.getByText('Solo queda 1 pieza.')).toBeTruthy()
    );
    fireEvent.click(view.getByRole('button', { name: 'Ajustar a 1' }));
    expect(getCartStore().getSnapshot()[0]).toEqual({
      sku: 'LAST',
      quantity: 1,
    });
  });
});

describe('CartSummary states', () => {
  const es = getMessages('es-MX');
  const quote = quoteOf([{ sku: 'TENT', quantity: 1 }]);
  const show = renderSummary;

  it.each([
    [{ status: 'loading', quote, error: null }, es.cart.summary.updating],
    [{ status: 'error', quote, error: 'offline' }, es.cart.summary.offline],
    [{ status: 'error', quote, error: 'timeout' }, es.cart.summary.failed],
  ] as const)('says why the amounts may be out of date (%#)', (state, text) => {
    show(state as QuoteState);
    expect(screen.getByRole('status').textContent).toBe(text);
    expect(screen.getByText('1 pieza')).toBeTruthy();
  });

  it('shows no totals before the first quote, and no USD without a reference', () => {
    show({ status: 'loading', quote: null, error: null, shippingIssue: null });
    expect(screen.queryByText(/MXN/)).toBeNull();
    cleanup();
    show(
      {
        status: 'ready',
        quote: {
          ...quote,
          summary: { ...quote.summary, referenceUsdCents: null },
        },
        error: null,
        shippingIssue: null,
      },
      'en'
    );
    expect(screen.queryByText(/≈/)).toBeNull();
  });
});

describe('the quote in the background', () => {
  it('reports a failed quote while keeping the cart usable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 503 }))
    );
    getCartStore().addItem('TENT');
    showButton();
    fireEvent.click(cartLink());
    const view = within(panel());
    await waitFor(() =>
      expect(
        view.getByText(getMessages('es-MX').cart.summary.failed)
      ).toBeTruthy()
    );
    expect(view.getByText('TENT')).toBeTruthy();
  });
});

/** A quote with its shipping line, priced and split like the API does (FC 011). */
function withShipping(
  quote: CartQuote,
  code: NonNullable<CartQuote['summary']['shippingCode']>,
  total: number,
  remaining: number | null = null
): CartQuote {
  const base = Math.round((total * 100) / 116);
  const { summary } = quote;
  return {
    ...quote,
    summary: {
      ...summary,
      shippingCode: code,
      shippingBaseMxnCents: base,
      shippingTaxMxnCents: total - base,
      shippingTotalMxnCents: total,
      serviceable: code !== 'UNSERVICEABLE_DESTINATION',
      freeShippingRemainingMxnCents: remaining,
      subtotalMxnCents: summary.itemsBaseMxnCents + base,
      taxMxnCents: summary.itemsTaxMxnCents + total - base,
      totalMxnCents: summary.itemsTotalMxnCents + total,
    },
  };
}

describe('shipping in the cart (FC 011)', () => {
  const ship = getMessages('es-MX').cart.shipping;
  const select = (view: ReturnType<typeof within>) =>
    view.getByRole('combobox', { name: ship.stateLabel });

  it('offers the 32 states, prices shipping for the chosen one and remembers only its code', async () => {
    const api = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        items: { sku: string; quantity: number }[];
        destination?: { stateCode: string };
      };
      const quote = quoteOf(body.items);
      return new Response(
        JSON.stringify(
          body.destination ? withShipping(quote, 'STANDARD_RATE', 15000) : quote
        ),
        { status: 200 }
      );
    });
    vi.stubGlobal('fetch', api);
    getCartStore().addItem('TENT');
    showButton();
    fireEvent.click(cartLink());
    const view = within(panel());
    await waitFor(() => expect(view.getByText(ship.pending)).toBeTruthy());
    expect(select(view).querySelectorAll('option')).toHaveLength(33);

    fireEvent.change(select(view), { target: { value: 'ZAC' } });
    await waitFor(() => expect(view.getByText('$150.00 MXN')).toBeTruthy());
    expect(view.getByText('$161.60 MXN')).toBeTruthy(); // 11.60 + 150.00
    expect(localStorage.getItem('yekora_shipping_state_v1')).toBe('ZAC');
    const last = JSON.parse(String(api.mock.calls.at(-1)?.[1].body));
    // Only the state code travels: never a postal code, never an amount.
    expect(last).toEqual({
      items: [{ sku: 'TENT', quantity: 1 }],
      destination: { stateCode: 'ZAC' },
    });

    fireEvent.change(select(view), { target: { value: '' } });
    await waitFor(() => expect(view.getByText(ship.pending)).toBeTruthy());
    expect(localStorage.getItem('yekora_shipping_state_v1')).toBeNull();
  });

  it('keeps the cart and explains why when the API refuses to price shipping', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as {
          items: { sku: string; quantity: number }[];
          destination?: unknown;
        };
        return body.destination
          ? new Response(
              JSON.stringify({
                type: 'about:blank',
                title: 'Cart cannot be quoted',
                status: 400,
                detail: 'EMPTY_OR_UNAVAILABLE_CART',
              }),
              { status: 400 }
            )
          : new Response(JSON.stringify(quoteOf(body.items)), { status: 200 });
      })
    );
    getDestinationStore().setState('ZAC');
    getCartStore().addItem('PACK', 3); // only 2 in stock
    showButton();
    fireEvent.click(cartLink());
    const view = within(panel());
    await waitFor(() =>
      expect(view.getByText(ship.cartUnavailable)).toBeTruthy()
    );
    expect(view.getByText('Mochila')).toBeTruthy(); // the products quote is still shown
  });
});

describe('CartSummary shipping row (FC 011)', () => {
  const base = quoteOf([{ sku: 'TENT', quantity: 1 }]);
  const ready = (
    quote: CartQuote,
    shippingIssue: QuoteState['shippingIssue'] = null
  ) => ({ status: 'ready', quote, error: null, shippingIssue }) as QuoteState;
  const row = () => document.querySelector('[data-shipping]')?.textContent;

  it('names the state it cannot ship to, in each language, with a zero charge', () => {
    const quote = withShipping(base, 'UNSERVICEABLE_DESTINATION', 0);
    renderSummary(ready(quote), 'es-MX', 'CMX');
    expect(row()).toBe('Por el momento no enviamos a Ciudad de México.');
    cleanup();
    renderSummary(ready(quote), 'en', 'CMX');
    expect(row()).toBe("We don't ship to Mexico City at the moment.");
  });

  it('says free and confirms it when the threshold is reached', () => {
    renderSummary(
      ready(withShipping(base, 'FREE_SHIPPING', 0, 0)),
      'es-MX',
      'ZAC'
    );
    expect(row()).toBe('Gratis');
    expect(screen.getByText('Tu envío es gratis.')).toBeTruthy();
    expect(document.querySelector('progress')).toBeNull();
  });

  it('shows the progress toward free shipping with what is still missing', () => {
    renderSummary(
      ready(withShipping(base, 'STANDARD_RATE', 15000, 38840)),
      'es-MX',
      'ZAC'
    );
    expect(
      screen.getByText('Te faltan $388.40 MXN para el envío gratis.')
    ).toBeTruthy();
    const bar = screen.getByRole('progressbar', {
      name: 'Te faltan $388.40 MXN para el envío gratis.',
    });
    expect(bar.getAttribute('value')).toBe('1160');
    expect(bar.getAttribute('max')).toBe('40000');
  });

  it('asks to choose the state again when the API did not know the stored one', () => {
    renderSummary(ready(base, 'invalid_destination'), 'es-MX', 'ZAC');
    expect(row()).toBe(getMessages('es-MX').cart.shipping.invalidState);
  });

  it('waits for a state before pricing, and falls back to the code for an unknown name', () => {
    renderSummary(ready(base), 'es-MX', null);
    expect(row()).toBe(getMessages('es-MX').cart.shipping.pending);
    cleanup();
    renderSummary(
      ready(withShipping(base, 'UNSERVICEABLE_DESTINATION', 0)),
      'es-MX',
      'XYZ'
    );
    expect(row()).toBe('Por el momento no enviamos a XYZ.');
  });
});
