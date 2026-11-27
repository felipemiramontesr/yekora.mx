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
import {
  closeTill,
  listCounterProducts,
  moveTillCash,
  openTill,
  readReceipt,
  readShift,
  sell,
} from '@/lib/api/posClient';
import { AccountPosConsole } from './AccountPosConsole';

vi.mock('@/lib/api/posClient', () => ({
  readShift: vi.fn(),
  openTill: vi.fn(),
  moveTillCash: vi.fn(),
  closeTill: vi.fn(),
  listCounterProducts: vi.fn(),
  sell: vi.fn(),
  readReceipt: vi.fn(),
}));

const api = {
  shift: vi.mocked(readShift),
  open: vi.mocked(openTill),
  move: vi.mocked(moveTillCash),
  close: vi.mocked(closeTill),
  products: vi.mocked(listCounterProducts),
  sell: vi.mocked(sell),
  receipt: vi.mocked(readReceipt),
};

const t = getMessages('es-MX').account.pos;
const SHIFT = {
  id: 4,
  cashierUserId: 'u',
  openedAt: '2026-11-27T18:00:00.000Z',
  openingCashMxnCents: 50000,
};
const PACK = {
  sku: 'PACK',
  nameEs: 'Mochila',
  nameEn: 'Backpack',
  priceMxnCents: 116000,
  available: 3,
};
const NONE = { ...PACK, sku: 'EMPTY', available: 0 };
const ok = <T,>(data: T) => ({ ok: true as const, data });
const no = (reason: string) => ({ ok: false as const, reason }) as never;

const show = (locale: Locale = 'es-MX') =>
  render(
    <AccountPosConsole
      texts={getMessages(locale).account.pos}
      locale={locale}
    />
  );
const field = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = (name: string) =>
  fireEvent.submit(screen.getByRole('form', { name }));

async function openShiftScreen() {
  api.shift.mockResolvedValue(ok({ shift: SHIFT }));
  show();
  await screen.findByText(/Turno abierto con un fondo de \$500\.00 MXN/);
}

async function addToCart() {
  api.products.mockResolvedValue(ok({ items: [PACK, NONE] }));
  submit(t.searchTitle);
  fireEvent.click(
    await screen.findByRole('button', { name: `${t.add}: PACK` })
  );
}

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
});
afterEach(cleanup);

describe('the point of sale screen (FC 076 F4)', () => {
  it('opens the till when it is closed, refusing a bad amount and naming a refusal', async () => {
    api.shift.mockResolvedValue(ok({ shift: null }));
    show();
    await screen.findByRole('form', { name: t.openTitle });
    field(t.openingCash, 'abc');
    submit(t.openTitle);
    expect(screen.getByText(t.invalidAmount)).toBeTruthy();
    field(t.openingCash, '500');
    api.open.mockResolvedValueOnce(no('POS_SHIFT_ALREADY_OPEN'));
    submit(t.openTitle);
    expect(
      await screen.findByText(t.errors.POS_SHIFT_ALREADY_OPEN)
    ).toBeTruthy();
    api.open.mockResolvedValue(ok(SHIFT));
    submit(t.openTitle);
    expect(await screen.findByText(/Turno abierto/)).toBeTruthy();
    expect(api.open).toHaveBeenLastCalledWith(50000);
  });

  it('says why the till cannot be read, in a generic way for an unknown reason', async () => {
    api.shift.mockResolvedValue(no('SOMETHING'));
    show();
    expect(await screen.findByText(t.errors.unknown)).toBeTruthy();
  });

  it('sells for cash: search, add twice, remove, change, e-mail, receipt and print', async () => {
    await openShiftScreen();
    await addToCart();
    fireEvent.click(screen.getByRole('button', { name: `${t.add}: PACK` }));
    expect(screen.getByText(/2 × Mochila/)).toBeTruthy();
    expect(
      (
        screen.getByRole('button', {
          name: `${t.add}: EMPTY`,
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: `${t.remove}: PACK` }));
    expect(screen.queryByRole('form', { name: t.chargeTitle })).toBeNull();
    await addToCart();
    field(t.tendered, '1200');
    expect(screen.getByText(/Cambio: \$40\.00 MXN/)).toBeTruthy();
    field(t.email, 'ana@example.test');
    api.sell.mockResolvedValue(
      ok({
        orderNumber: 'YEK-2026-AAAA0001',
        method: 'POS_CASH' as const,
        totalMxnCents: 116000,
        changeMxnCents: 4000,
      })
    );
    submit(t.chargeTitle);
    expect(await screen.findByText(/Venta YEK-2026-AAAA0001/)).toBeTruthy();
    expect(api.sell).toHaveBeenCalledWith({
      items: [{ sku: 'PACK', quantity: 1 }],
      payment: { method: 'POS_CASH', tenderedMxnCents: 120000 },
      customerEmail: 'ana@example.test',
    });
    api.receipt.mockResolvedValueOnce(no('offline'));
    fireEvent.click(screen.getByRole('button', { name: t.showReceipt }));
    expect(await screen.findByText(t.errors.offline)).toBeTruthy();
    api.receipt.mockResolvedValue(
      ok({
        orderNumber: 'YEK-2026-AAAA0001',
        widthMm: 80 as const,
        lines: ['YEKORA', 'TOTAL $1160.00'],
      })
    );
    fireEvent.click(screen.getByRole('button', { name: t.showReceipt }));
    expect(await screen.findByText(/TOTAL \$1160\.00/)).toBeTruthy();
    const print = vi.fn();
    vi.stubGlobal('print', print);
    fireEvent.click(screen.getByRole('button', { name: t.print }));
    expect(print).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('sells on the terminal with only the voucher data, and keeps the cart on a refusal', async () => {
    await openShiftScreen();
    await addToCart();
    field(t.method, 'POS_CARD_MANUAL');
    expect(
      screen.getByText(/Cobra \$1,160\.00 MXN en la terminal Banorte/)
    ).toBeTruthy();
    field(t.authCode, ' A1B2 ');
    field(t.lastFour, '4242');
    field(t.brand, 'Visa');
    field(t.folio, 'F-1');
    api.sell.mockResolvedValue(no('INVALID_VOUCHER_DATA_REJECT'));
    submit(t.chargeTitle);
    expect(
      await screen.findByText(t.errors.INVALID_VOUCHER_DATA_REJECT)
    ).toBeTruthy();
    expect(screen.getByRole('form', { name: t.chargeTitle })).toBeTruthy();
    expect(api.sell).toHaveBeenCalledWith({
      items: [{ sku: 'PACK', quantity: 1 }],
      payment: {
        method: 'POS_CARD_MANUAL',
        confirmedAmountMxnCents: 116000,
        terminalAuthCode: 'A1B2',
        cardLastFour: '4242',
        cardBrand: 'Visa',
        voucherFolio: 'F-1',
      },
    });
  });

  it('sends 0 as the cash when nothing was typed, and says why a search failed', async () => {
    await openShiftScreen();
    await addToCart();
    api.sell.mockResolvedValue(no('INSUFFICIENT_TENDERED_REJECT'));
    submit(t.chargeTitle);
    await screen.findByText(t.errors.INSUFFICIENT_TENDERED_REJECT);
    expect(api.sell.mock.calls[0][0].payment).toEqual({
      method: 'POS_CASH',
      tenderedMxnCents: 0,
    });
    api.products.mockResolvedValue(no('offline'));
    field(t.search, 'moch');
    submit(t.searchTitle);
    expect(await screen.findByText(t.errors.offline)).toBeTruthy();
    expect(api.products).toHaveBeenLastCalledWith('moch');
  });

  it('records a movement of cash, after checking amount and reason', async () => {
    await openShiftScreen();
    submit(t.movementsTitle);
    expect(screen.getByText(t.invalidMovement)).toBeTruthy();
    field(t.movementType, 'IN');
    field(t.movementAmount, '200');
    field(t.movementReason, 'Cambio');
    api.move.mockResolvedValueOnce(no('INSUFFICIENT_DRAWER_CASH_REJECT'));
    submit(t.movementsTitle);
    expect(
      await screen.findByText(t.errors.INSUFFICIENT_DRAWER_CASH_REJECT)
    ).toBeTruthy();
    api.move.mockResolvedValue(
      ok({ id: 1, shiftId: 4, type: 'IN' as const, amountMxnCents: 20000 })
    );
    submit(t.movementsTitle);
    expect(await screen.findByText(t.moved)).toBeTruthy();
    expect(api.move).toHaveBeenLastCalledWith({
      shiftId: 4,
      type: 'IN',
      amountMxnCents: 20000,
      reason: 'Cambio',
    });
  });

  it('closes with a blind count, with the notes when there are any', async () => {
    await openShiftScreen();
    const form = screen.getByRole('form', { name: t.closeTitle });
    expect(form.textContent).not.toMatch(/esperad|expected/i);
    submit(t.closeTitle);
    expect(within(form).getByText(t.invalidAmount)).toBeTruthy();
    field(t.counted, '490');
    api.close.mockResolvedValueOnce(no('MISSING_DIFF_JUSTIFICATION_REJECT'));
    submit(t.closeTitle);
    expect(
      await screen.findByText(t.errors.MISSING_DIFF_JUSTIFICATION_REJECT)
    ).toBeTruthy();
    expect(api.close).toHaveBeenLastCalledWith(4, {
      countedCashMxnCents: 49000,
    });
    field(t.notes, 'faltó cambio en caja');
    api.close.mockResolvedValue(
      ok({
        id: 4,
        expectedCashMxnCents: 50000,
        countedCashMxnCents: 49000,
        differenceMxnCents: -1000,
      })
    );
    submit(t.closeTitle);
    expect(await screen.findByText(/Turno cerrado/)).toBeTruthy();
    expect(screen.getByRole('form', { name: t.openTitle })).toBeTruthy();
    await waitFor(() =>
      expect(api.close).toHaveBeenLastCalledWith(4, {
        countedCashMxnCents: 49000,
        notes: 'faltó cambio en caja',
      })
    );
  });

  it('adds another unit to the product chosen again, leaving the other lines alone', async () => {
    await openShiftScreen();
    api.products.mockResolvedValue(
      ok({ items: [PACK, { ...PACK, sku: 'ROPE', nameEs: 'Cuerda' }] })
    );
    submit(t.searchTitle);
    const add = async (sku: string) =>
      fireEvent.click(
        await screen.findByRole('button', { name: `${t.add}: ${sku}` })
      );
    await add('PACK');
    await add('ROPE');
    await add('PACK');
    expect(screen.getByText(/2 × Mochila/)).toBeTruthy();
    expect(screen.getByText(/1 × Cuerda/)).toBeTruthy();
  });

  it('speaks English with the English name of the product', async () => {
    const en = getMessages('en').account.pos;
    api.shift.mockResolvedValue(ok({ shift: SHIFT }));
    show('en');
    await screen.findByText(/Shift open/);
    api.products.mockResolvedValue(ok({ items: [PACK] }));
    fireEvent.submit(screen.getByRole('form', { name: en.searchTitle }));
    expect(await screen.findByText(/Backpack · PACK/)).toBeTruthy();
  });
});
