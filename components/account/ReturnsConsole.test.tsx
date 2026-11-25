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
import type { ReturnView } from '@/lib/account/returnTypes';
import {
  confirmReturn,
  listReturns,
  prepareReturn,
} from '@/lib/api/returnsClient';
import { ReturnsConsole } from './ReturnsConsole';

vi.mock('@/lib/api/returnsClient', () => ({
  listReturns: vi.fn(),
  prepareReturn: vi.fn(),
  confirmReturn: vi.fn(),
}));

const api = {
  list: vi.mocked(listReturns),
  prepare: vi.mocked(prepareReturn),
  confirm: vi.mocked(confirmReturn),
};

const t = getMessages('es-MX').account.returns;

const request = (overrides: Partial<ReturnView> = {}): ReturnView => ({
  id: 7,
  orderNumber: 'YEK-2026-AAAA0001',
  status: 'REQUESTED',
  reason: 'DEFECT',
  comment: null,
  items: [{ sku: 'E2E-0001', quantity: 2 }],
  refundMxnCents: null,
  restock: null,
  createdAt: '2026-11-25T18:00:00.000Z',
  preparedAt: null,
  confirmedAt: null,
  ...overrides,
});

const ok = (data: ReturnView) => ({ ok: true as const, data });
const no = (reason: string) => ({ ok: false as const, reason }) as never;
const page = (items: ReturnView[]) => ({
  ok: true as const,
  data: { items, total: items.length },
});

const BOTH = { canPrepare: true, canConfirm: true };

const open = async (
  items: ReturnView[],
  grants = BOTH,
  locale: Locale = 'es-MX'
) => {
  api.list.mockResolvedValue(page(items));
  render(
    <ReturnsConsole
      texts={getMessages(locale).account.returns}
      locale={locale}
      {...grants}
    />
  );
  await screen.findByText(
    getMessages(locale).account.returns.total.replace(
      '{n}',
      String(items.length)
    )
  );
};

beforeEach(() => {
  api.list.mockReset();
  api.prepare.mockReset();
  api.confirm.mockReset();
});
afterEach(cleanup);

describe('board of returns (FC 073 F1)', () => {
  it('lists the requests with their order, reason, lines and stage', async () => {
    await open([
      request({ comment: 'Llegó roto' }),
      request({
        id: 8,
        orderNumber: 'YEK-2026-BBBB0002',
        reason: 'CHANGED_MIND',
        status: 'REFUNDED',
        refundMxnCents: 48500,
        restock: true,
      }),
    ]);
    expect(
      screen.getByRole('heading', { name: 'Pedido YEK-2026-AAAA0001' })
    ).toBeTruthy();
    expect(screen.getByText(t.reasons.DEFECT)).toBeTruthy();
    expect(screen.getByText('Llegó roto')).toBeTruthy();
    expect(screen.getAllByText('E2E-0001 × 2')).toHaveLength(2);
    expect(
      screen.getByText(t.stages.REQUESTED, { selector: 'span' })
    ).toBeTruthy();
    expect(screen.getByText(/Reembolso preparado: \$485\.00 MXN/)).toBeTruthy();
    expect(screen.getByText(/Las piezas vuelven al inventario/)).toBeTruthy();
  });

  it('says so when there are no requests, and why when the board cannot load', async () => {
    api.list.mockResolvedValue(page([]));
    render(<ReturnsConsole texts={t} locale="es-MX" {...BOTH} />);
    expect(await screen.findByText(t.empty)).toBeTruthy();
    cleanup();
    api.list.mockResolvedValue(no('PERMISSION_DENIED'));
    render(<ReturnsConsole texts={t} locale="es-MX" {...BOTH} />);
    expect(await screen.findByText(t.errors.PERMISSION_DENIED)).toBeTruthy();
    cleanup();
    api.list.mockResolvedValue(no('SOMETHING_NEW'));
    render(<ReturnsConsole texts={t} locale="es-MX" {...BOTH} />);
    expect(await screen.findByText(t.errors.unknown)).toBeTruthy();
  });

  it('asks the API for one stage when the filter changes, and for all again', async () => {
    await open([request()]);
    expect(api.list).toHaveBeenLastCalledWith(undefined);
    api.list.mockResolvedValue(page([]));
    fireEvent.change(screen.getByLabelText(t.filterLabel), {
      target: { value: 'PREPARED' },
    });
    await screen.findByText(t.empty);
    expect(api.list).toHaveBeenLastCalledWith('PREPARED');
    api.list.mockResolvedValue(page([request()]));
    fireEvent.change(screen.getByLabelText(t.filterLabel), {
      target: { value: '' },
    });
    await screen.findByText('Pedido YEK-2026-AAAA0001');
    expect(api.list).toHaveBeenLastCalledWith(undefined);
  });

  it('offers a step only to whoever holds its permission, by stage (T1.2a, T1.2b)', async () => {
    await open(
      [
        request(),
        request({ id: 8, status: 'PREPARED', refundMxnCents: 100 }),
        request({ id: 9, status: 'REFUNDING', refundMxnCents: 100 }),
        request({ id: 10, status: 'REFUNDED', refundMxnCents: 100 }),
      ],
      BOTH
    );
    expect(screen.getAllByRole('button', { name: t.prepare })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: t.confirm })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: t.retry })).toHaveLength(1);
    cleanup();
    await open(
      [request(), request({ id: 8, status: 'PREPARED', refundMxnCents: 100 })],
      { canPrepare: false, canConfirm: false }
    );
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('prepares a refund: the amount in pesos travels as cents, with the restock choice', async () => {
    await open([
      request(),
      request({
        id: 8,
        orderNumber: 'YEK-2026-BBBB0002',
        status: 'REFUNDED',
        refundMxnCents: 100,
        restock: true,
      }),
    ]);
    api.prepare.mockResolvedValue(
      ok(request({ status: 'PREPARED', refundMxnCents: 48550, restock: false }))
    );
    fireEvent.click(screen.getByRole('button', { name: t.prepare }));
    fireEvent.change(screen.getByLabelText(t.amount), {
      target: { value: '485.50' },
    });
    fireEvent.click(screen.getByLabelText(t.restock));
    fireEvent.click(
      within(
        screen.getByRole('form', {
          name: 'Preparar el reembolso del pedido YEK-2026-AAAA0001',
        })
      ).getByRole('button', { name: t.prepare })
    );
    await screen.findByText(
      'Listo. El reembolso del pedido YEK-2026-AAAA0001 quedó preparado; otra persona debe confirmarlo.'
    );
    expect(api.prepare).toHaveBeenCalledWith(7, {
      refundMxnCents: 48550,
      restock: false,
    });
    expect(screen.getByText(/Reembolso preparado: \$485\.50 MXN/)).toBeTruthy();
    expect(
      screen.getByText(/Las piezas no vuelven al inventario/)
    ).toBeTruthy();
    expect(
      screen.getByText(t.stages.PREPARED, { selector: 'span' })
    ).toBeTruthy();
  });

  it.each(['', 'abc', '0', '0.00', '12.345', '1000000.01'])(
    'refuses the amount "%s" before asking the API',
    async (typed) => {
      await open([request()]);
      fireEvent.click(screen.getByRole('button', { name: t.prepare }));
      fireEvent.change(screen.getByLabelText(t.amount), {
        target: { value: typed },
      });
      fireEvent.submit(screen.getByRole('form'));
      expect(await screen.findByText(t.invalidAmount)).toBeTruthy();
      expect(api.prepare).not.toHaveBeenCalled();
    }
  );

  it('explains a refusal of the preparation and keeps the form to correct it', async () => {
    await open([request()]);
    api.prepare.mockResolvedValue(no('INVALID_REFUND_AMOUNT_REJECT'));
    fireEvent.click(screen.getByRole('button', { name: t.prepare }));
    fireEvent.change(screen.getByLabelText(t.amount), {
      target: { value: '999' },
    });
    fireEvent.submit(screen.getByRole('form'));
    expect(
      await screen.findByText(t.errors.INVALID_REFUND_AMOUNT_REJECT)
    ).toBeTruthy();
    expect(screen.getByRole('form')).toBeTruthy();
  });

  it('closes the form with Cancel, in both steps', async () => {
    await open([
      request(),
      request({ id: 8, status: 'PREPARED', refundMxnCents: 100 }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: t.prepare }));
    fireEvent.click(screen.getByRole('button', { name: t.cancel }));
    expect(screen.queryByRole('form')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: t.confirm }));
    expect(screen.getByRole('form')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t.cancel }));
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('confirms a prepared refund with no reference for Stripe', async () => {
    await open([
      request({ status: 'PREPARED', refundMxnCents: 48500, restock: true }),
    ]);
    api.confirm.mockResolvedValue(
      ok(request({ status: 'REFUNDED', refundMxnCents: 48500, restock: true }))
    );
    fireEvent.click(screen.getByRole('button', { name: t.confirm }));
    expect(screen.getByText(/Se reembolsarán \$485\.00 MXN/)).toBeTruthy();
    expect(screen.queryByText(t.retryNote)).toBeNull();
    fireEvent.submit(screen.getByRole('form'));
    await screen.findByText(
      'Listo. El pedido YEK-2026-AAAA0001 quedó reembolsado.'
    );
    expect(api.confirm).toHaveBeenCalledWith(7, {});
    expect(screen.queryByRole('button', { name: t.confirm })).toBeNull();
  });

  it('sends the reference of a refund made by hand at Mercado Pago, trimmed (T2.3)', async () => {
    await open([
      request({ status: 'PREPARED', refundMxnCents: 48500, restock: true }),
    ]);
    api.confirm.mockResolvedValue(
      ok(request({ status: 'REFUNDED', refundMxnCents: 48500, restock: true }))
    );
    fireEvent.click(screen.getByRole('button', { name: t.confirm }));
    fireEvent.change(screen.getByLabelText(t.manualReference), {
      target: { value: '  MP-123456789 ' },
    });
    fireEvent.submit(screen.getByRole('form'));
    await waitFor(() =>
      expect(api.confirm).toHaveBeenCalledWith(7, {
        manualReference: 'MP-123456789',
      })
    );
  });

  it.each([
    'DUAL_CONTROL_VIOLATION_REJECT',
    'MANUAL_REFERENCE_REQUIRED',
    'REFUND_PROCESSOR_ERROR',
  ] as const)(
    'names the refusal %s of the confirmation without breaking the board (T2.1, T2.3)',
    async (code) => {
      await open([
        request({ status: 'PREPARED', refundMxnCents: 48500, restock: true }),
      ]);
      api.confirm.mockResolvedValue(no(code));
      fireEvent.click(screen.getByRole('button', { name: t.confirm }));
      fireEvent.submit(screen.getByRole('form'));
      expect(await screen.findByText(t.errors[code])).toBeTruthy();
      expect(screen.getByRole('form')).toBeTruthy();
    }
  );

  it('offers a retry on a refund the processor did not confirm, and says it is safe', async () => {
    await open([
      request({ status: 'REFUNDING', refundMxnCents: 48500, restock: true }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: t.retry }));
    expect(screen.getByText(t.retryNote)).toBeTruthy();
  });

  it('speaks English with the amounts and dates of the page', async () => {
    const en = getMessages('en').account.returns;
    await open(
      [request({ status: 'PREPARED', refundMxnCents: 48500, restock: true })],
      BOTH,
      'en'
    );
    expect(
      screen.getByRole('heading', { name: 'Order YEK-2026-AAAA0001' })
    ).toBeTruthy();
    expect(screen.getByText(en.reasons.DEFECT)).toBeTruthy();
    expect(screen.getByText(/Requested on Nov 25, 2026/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: en.confirm }));
    expect(screen.getByText(/\$485\.00 MXN will be refunded/)).toBeTruthy();
  });

  it('ignores the answer of a filter that is no longer the open one', async () => {
    let late: (value: ReturnType<typeof page>) => void = vi.fn();
    api.list.mockReturnValueOnce(
      new Promise((resolve) => {
        late = resolve;
      })
    );
    const { unmount } = render(
      <ReturnsConsole texts={t} locale="es-MX" {...BOTH} />
    );
    unmount();
    late(page([request()]));
    await Promise.resolve();
    expect(screen.queryByText('Pedido YEK-2026-AAAA0001')).toBeNull();
  });
});
