// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMessages, type Locale } from '@/app/i18n';
import type { OrderDetail } from '@/lib/account/orderTypes';
import {
  deliverOrder,
  prepareOrder,
  shipOrder,
} from '@/lib/api/fulfillmentClient';
import { OrderFulfillment } from './OrderFulfillment';

vi.mock('@/lib/api/fulfillmentClient', () => ({
  prepareOrder: vi.fn(),
  shipOrder: vi.fn(),
  deliverOrder: vi.fn(),
}));

const api = {
  prepare: vi.mocked(prepareOrder),
  ship: vi.mocked(shipOrder),
  deliver: vi.mocked(deliverOrder),
};

const t = getMessages('es-MX').account.fulfillment;
const statuses = getMessages('es-MX').account.statuses;

const order = (over: Partial<OrderDetail> = {}): OrderDetail =>
  ({
    orderNumber: 'YEK-2026-AB12CD34',
    status: 'PAID',
    fulfillment: null,
    carrier: null,
    trackingNumber: null,
    trackingUrl: null,
    shippedAt: null,
    deliveredAt: null,
    ...over,
  }) as OrderDetail;

const result = (fulfillment: 'PREPARING' | 'SHIPPED' | 'DELIVERED') => ({
  ok: true as const,
  data: {
    orderNumber: 'YEK-2026-AB12CD34',
    fulfillment,
    carrier: null,
    trackingNumber: null,
    trackingUrl: null,
    shippedAt: null,
    deliveredAt: null,
  },
});
const no = (reason: string) => ({ ok: false as const, reason }) as never;

function show(
  current: OrderDetail,
  onDone = vi.fn(),
  locale: Locale = 'es-MX'
) {
  const texts = getMessages(locale).account;
  render(
    <OrderFulfillment
      order={current}
      texts={texts.fulfillment}
      statuses={texts.statuses}
      exampleLabel={texts.exampleLabel}
      onDone={onDone}
    />
  );
  return onDone;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the fulfillment of an order in the panel (FC 068 F1)', () => {
  it('a paid order offers to start preparing it and to record the shipment, and not to deliver', () => {
    show(order());
    expect(screen.getByRole('button', { name: t.prepare })).toBeTruthy();
    expect(screen.getByRole('form', { name: t.shipTitle })).toBeTruthy();
    expect(screen.queryByRole('button', { name: t.deliver })).toBeNull();
    expect(screen.queryByText(t.noActions)).toBeNull();
  });

  it('one being prepared offers only the shipment', () => {
    show(order({ fulfillment: 'PREPARING' }));
    expect(screen.queryByRole('button', { name: t.prepare })).toBeNull();
    expect(screen.getByRole('form', { name: t.shipTitle })).toBeTruthy();
  });

  it('one that shipped offers only to mark it delivered', () => {
    show(order({ fulfillment: 'SHIPPED' }));
    expect(screen.getByRole('button', { name: t.deliver })).toBeTruthy();
    expect(screen.queryByRole('form', { name: t.shipTitle })).toBeNull();
    expect(screen.queryByRole('button', { name: t.prepare })).toBeNull();
  });

  it.each([
    ['a delivered one', order({ fulfillment: 'DELIVERED' })],
    ['an unpaid one', order({ status: 'PENDING_PAYMENT' })],
    ['an expired one', order({ status: 'EXPIRED' })],
  ])('%s offers nothing and says so', (_case, current) => {
    show(current);
    expect(screen.getByText(t.noActions)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('prepares, says the new status and asks for the order again', async () => {
    api.prepare.mockResolvedValue(result('PREPARING'));
    const done = show(order());
    fireEvent.click(screen.getByRole('button', { name: t.prepare }));
    await screen.findByText(`Listo. El pedido quedó «${statuses.PREPARING}».`);
    expect(api.prepare).toHaveBeenCalledWith('YEK-2026-AB12CD34');
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('ships with the carrier, the tracking number and the link typed, trimmed', async () => {
    api.ship.mockResolvedValue(result('SHIPPED'));
    const done = show(order({ fulfillment: 'PREPARING' }));
    const form = screen.getByRole('form', { name: t.shipTitle });
    fireEvent.change(within(form).getByLabelText(t.carrier), {
      target: { value: 'DHL' },
    });
    fireEvent.change(within(form).getByLabelText(t.trackingNumber), {
      target: { value: '1234567890' },
    });
    fireEvent.change(within(form).getByLabelText(t.trackingUrl), {
      target: { value: ' https://www.dhl.com/track?id=1 ' },
    });
    fireEvent.submit(form);
    await screen.findByText(`Listo. El pedido quedó «${statuses.SHIPPED}».`);
    expect(api.ship).toHaveBeenCalledWith('YEK-2026-AB12CD34', {
      carrier: 'DHL',
      trackingNumber: '1234567890',
      trackingUrl: 'https://www.dhl.com/track?id=1',
    });
    expect(done).toHaveBeenCalled();
  });

  it('ships without a link when none is typed', async () => {
    api.ship.mockResolvedValue(result('SHIPPED'));
    show(order());
    const form = screen.getByRole('form', { name: t.shipTitle });
    fireEvent.change(within(form).getByLabelText(t.carrier), {
      target: { value: 'Estafeta' },
    });
    fireEvent.change(within(form).getByLabelText(t.trackingNumber), {
      target: { value: 'EF1' },
    });
    fireEvent.submit(form);
    await waitFor(() =>
      expect(api.ship).toHaveBeenCalledWith('YEK-2026-AB12CD34', {
        carrier: 'Estafeta',
        trackingNumber: 'EF1',
      })
    );
  });

  it('marks as delivered and asks for the order again', async () => {
    api.deliver.mockResolvedValue(result('DELIVERED'));
    const done = show(order({ fulfillment: 'SHIPPED' }));
    fireEvent.click(screen.getByRole('button', { name: t.deliver }));
    await screen.findByText(`Listo. El pedido quedó «${statuses.DELIVERED}».`);
    expect(done).toHaveBeenCalled();
  });

  it('names a refusal by its code, a generic one otherwise, and does not ask for the order again', async () => {
    api.prepare.mockResolvedValueOnce(no('ORDER_STATUS_CONFLICT'));
    const done = show(order());
    fireEvent.click(screen.getByRole('button', { name: t.prepare }));
    expect(
      await screen.findByText(t.errors.ORDER_STATUS_CONFLICT)
    ).toBeTruthy();
    api.prepare.mockResolvedValueOnce(no('weird'));
    fireEvent.click(screen.getByRole('button', { name: t.prepare }));
    expect(await screen.findByText(t.errors.unknown)).toBeTruthy();
    expect(done).not.toHaveBeenCalled();
  });

  it('blocks the button while a step runs', async () => {
    const pending = Promise.withResolvers<ReturnType<typeof result>>();
    api.prepare.mockReturnValue(pending.promise);
    show(order());
    fireEvent.click(screen.getByRole('button', { name: t.prepare }));
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('button', { name: t.working })
          .every((button) => (button as HTMLButtonElement).disabled)
      ).toBe(true)
    );
    pending.resolve(result('PREPARING'));
    await screen.findByText(/Listo/);
  });

  it('speaks English in the English page', () => {
    show(order(), vi.fn(), 'en');
    const english = getMessages('en').account.fulfillment;
    expect(screen.getByRole('button', { name: english.prepare })).toBeTruthy();
  });
});
