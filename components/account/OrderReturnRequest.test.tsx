// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages, type Locale } from '@/app/i18n';
import type { OrderDetail } from '@/lib/account/orderTypes';
import { requestReturn } from '@/lib/api/returnsClient';
import { OrderReturnRequest } from './OrderReturnRequest';

vi.mock('@/lib/api/returnsClient', () => ({ requestReturn: vi.fn() }));
const send = vi.mocked(requestReturn);

const t = getMessages('es-MX').account.returnRequest;
const DAY_MS = 24 * 60 * 60 * 1000;
const ago = (days: number) =>
  new Date(Date.now() - days * DAY_MS).toISOString();

const order = (overrides: Partial<OrderDetail> = {}): OrderDetail =>
  ({
    orderNumber: 'YEK-2026-AAAA0001',
    status: 'PAID',
    fulfillment: 'DELIVERED',
    deliveredAt: ago(5),
    lines: [
      {
        sku: 'PACK-30',
        quantity: 3,
        unitPriceMxnCents: 100,
        lineTotalMxnCents: 300,
        allowsReturn: true,
        returnedQuantity: 1,
      },
      {
        sku: 'FINAL-1',
        quantity: 1,
        unitPriceMxnCents: 100,
        lineTotalMxnCents: 100,
        allowsReturn: false,
        returnedQuantity: 0,
      },
    ],
    ...overrides,
  }) as OrderDetail;

const created = {
  ok: true as const,
  data: {
    id: 1,
    orderNumber: 'YEK-2026-AAAA0001',
    status: 'REQUESTED' as const,
    reason: 'DEFECT' as const,
    comment: null,
    items: [{ sku: 'PACK-30', quantity: 2 }],
    refundMxnCents: null,
    restock: null,
    createdAt: '2026-11-25T18:00:00.000Z',
    preparedAt: null,
    confirmedAt: null,
    counter: false,
  },
};
const no = (reason: string) => ({ ok: false as const, reason }) as never;

const show = (
  subject: OrderDetail = order(),
  locale: Locale = 'es-MX',
  onDone = vi.fn()
) => {
  const texts = getMessages(locale).account;
  render(
    <OrderReturnRequest
      order={subject}
      texts={texts.returnRequest}
      locale={locale}
      exampleLabel={texts.exampleLabel}
      onDone={onDone}
    />
  );
  return onDone;
};
const openForm = () =>
  fireEvent.click(screen.getByRole('button', { name: t.open }));
const units = (value: string) =>
  fireEvent.change(screen.getByLabelText(/Piezas de PACK-30/), {
    target: { value },
  });
const reason = (value: string) =>
  fireEvent.change(screen.getByLabelText(t.reasonLabel), {
    target: { value },
  });
const submit = () => fireEvent.submit(screen.getByRole('form'));

beforeEach(() => send.mockReset());
afterEach(cleanup);

describe('«Solicitar devolución» on the order page (FC 073 F2, T1.1, T2.4)', () => {
  it('shows the button for a delivered order inside the window with units left', () => {
    show();
    expect(screen.getByRole('button', { name: t.open })).toBeTruthy();
  });

  it.each([
    ['not delivered', order({ fulfillment: 'SHIPPED' })],
    ['the window is over', order({ deliveredAt: ago(61) })],
    ['nothing is left to return', order({ lines: [] })],
  ])('shows nothing when %s', (_case, subject) => {
    show(subject);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('offers only the lines that can still come back, with the closing date of the window', () => {
    show();
    openForm();
    expect(
      screen.getByLabelText(/Piezas de PACK-30 que devuelves \(hasta 2\)/)
    ).toBeTruthy();
    expect(screen.queryByLabelText(/FINAL-1/)).toBeNull();
    expect(screen.getByText(/Tienes 60 días naturales/)).toBeTruthy();
  });

  it('sends the chosen units, the reason and the trimmed comment, then asks for the order again', async () => {
    send.mockResolvedValue(created);
    const onDone = show();
    openForm();
    units('2');
    reason('DEFECT');
    fireEvent.change(screen.getByLabelText(t.commentLabel), {
      target: { value: '  La cremallera llegó rota. ' },
    });
    submit();
    expect(await screen.findByText(t.sent)).toBeTruthy();
    expect(send).toHaveBeenCalledWith('YEK-2026-AAAA0001', {
      items: [{ sku: 'PACK-30', quantity: 2 }],
      reason: 'DEFECT',
      comment: 'La cremallera llegó rota.',
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('leaves the comment out when it is empty', async () => {
    send.mockResolvedValue(created);
    show();
    openForm();
    units('1');
    reason('CHANGED_MIND');
    submit();
    await screen.findByText(t.sent);
    expect(send).toHaveBeenCalledWith('YEK-2026-AAAA0001', {
      items: [{ sku: 'PACK-30', quantity: 1 }],
      reason: 'CHANGED_MIND',
    });
  });

  it.each(['3', '-1', '1.5'])(
    'refuses %s piece(s) before asking the API',
    async (typed) => {
      show();
      openForm();
      units(typed);
      reason('DEFECT');
      submit();
      expect(await screen.findByText(t.invalidQuantity)).toBeTruthy();
      expect(send).not.toHaveBeenCalled();
    }
  );

  it('asks for at least one piece when no field was touched', async () => {
    show();
    openForm();
    reason('DEFECT');
    submit();
    expect(await screen.findByText(t.chooseOne)).toBeTruthy();
  });

  it('asks for at least one piece, and for a reason', async () => {
    show();
    openForm();
    reason('DEFECT');
    units('0');
    submit();
    expect(await screen.findByText(t.chooseOne)).toBeTruthy();
    units('1');
    reason('');
    submit();
    expect(await screen.findByText(t.chooseReason)).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    'ORDER_NOT_DELIVERED_REJECT',
    'WINDOW_EXPIRED_REJECT',
    'PRODUCT_NON_RETURNABLE_REJECT',
    'INVALID_QUANTITY_REJECT',
    'RETURN_PAYLOAD_INVALID',
  ] as const)('names the refusal %s and keeps the form', async (code) => {
    send.mockResolvedValue(no(code));
    show();
    openForm();
    units('1');
    reason('DEFECT');
    submit();
    expect(await screen.findByText(t.errors[code])).toBeTruthy();
    expect(screen.getByRole('form')).toBeTruthy();
  });

  it('says something generic for a refusal it does not know', async () => {
    send.mockResolvedValue(no('PERMISSION_DENIED'));
    show();
    openForm();
    units('1');
    reason('DEFECT');
    submit();
    expect(await screen.findByText(t.errors.unknown)).toBeTruthy();
  });

  it('closes the form with Cancel and brings the button back', () => {
    show();
    openForm();
    fireEvent.click(screen.getByRole('button', { name: t.cancel }));
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.getByRole('button', { name: t.open })).toBeTruthy();
  });

  it('keeps the confirmation on screen after the last units were asked', async () => {
    send.mockResolvedValue(created);
    const { rerender } = render(<></>);
    rerender(<></>);
    const texts = getMessages('es-MX').account;
    const props = {
      texts: texts.returnRequest,
      locale: 'es-MX' as const,
      exampleLabel: texts.exampleLabel,
      onDone: vi.fn(),
    };
    rerender(<OrderReturnRequest order={order()} {...props} />);
    openForm();
    units('2');
    reason('DEFECT');
    submit();
    await screen.findByText(t.sent);
    // The order is read again: every unit is asked, so the offer is gone but the note stays.
    rerender(<OrderReturnRequest order={order({ lines: [] })} {...props} />);
    expect(screen.getByText(t.sent)).toBeTruthy();
    expect(screen.queryByRole('button', { name: t.open })).toBeNull();
  });

  it('speaks English', () => {
    const en = getMessages('en').account.returnRequest;
    show(order(), 'en');
    fireEvent.click(screen.getByRole('button', { name: en.open }));
    expect(screen.getByText(/You have 60 calendar days/)).toBeTruthy();
    expect(screen.getByLabelText(en.reasonLabel)).toBeTruthy();
  });
});
