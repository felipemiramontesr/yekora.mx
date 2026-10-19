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
    expect(view.getAllByText('$34.80 MXN')).toHaveLength(2); // line and total
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
  const show = (state: QuoteState, locale: Locale = 'es-MX') =>
    render(
      <CartSummary
        locale={locale}
        state={state}
        messages={getMessages(locale).cart}
        priceMessages={getMessages(locale).catalog.price}
      />
    );

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
    show({ status: 'loading', quote: null, error: null });
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
