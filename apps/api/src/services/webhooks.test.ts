import { describe, expect, it, vi } from 'vitest';
import type { PaymentsConfig } from '../config';
import type { Db, Transactional, TxQuery } from './db';
import type {
  PaymentProcessorPort,
  PaymentStatus,
  VerifiedEvent,
} from './paymentPort';
import { receiveWebhook, type WebhookDeps } from './webhooks';

const NOW = new Date('2026-10-21T19:00:00Z');
const DUPLICATE = Object.assign(new Error('Duplicate entry'), {
  code: 'ER_DUP_ENTRY',
});
const ORDER = 'YEK-2026-AB12CD34';

interface OrderState {
  id: number;
  number: string;
  processorId: number;
  total: number;
  status: number;
  resource: string | null;
  paidAt: Date | null;
}
interface EventRow {
  params: unknown[];
}

/**
 * In-memory tables for the receiver: one order of 200 000 cents at Stripe (processor 1), its
 * events, and the stock movements it asked for. `insertError` plays another delivery of the same
 * event recorded between our check and our insert.
 */
function webhookDb(order: Partial<OrderState> = {}, insertError?: Error) {
  const state = {
    order: {
      id: 7,
      number: ORDER,
      processorId: 1,
      total: 200000,
      status: 1,
      resource: null,
      paidAt: null,
      ...order,
    } as OrderState,
    events: [] as EventRow[],
    sold: [] as unknown[],
  };
  const sql: string[] = [];
  const handlers: [string, (p: unknown[]) => unknown][] = [
    [
      'SELECT id FROM payment_events',
      ([processorId, eventId]) =>
        state.events
          .filter((e) => e.params[0] === processorId && e.params[1] === eventId)
          .map(() => ({ id: 1 })),
    ],
    [
      'SELECT o.id, o.total_mxn_cents FROM orders o',
      ([number, processorId]) =>
        number === state.order.number && processorId === state.order.processorId
          ? [{ id: state.order.id, total_mxn_cents: String(state.order.total) }]
          : [],
    ],
    [
      'INSERT INTO payment_events',
      (p) => {
        if (insertError) throw insertError;
        state.events.push({ params: p });
        return { affectedRows: 1 };
      },
    ],
    [
      'SELECT status_id, payment_resource_id FROM orders',
      () => [
        {
          status_id: String(state.order.status),
          payment_resource_id: state.order.resource,
        },
      ],
    ],
    [
      'UPDATE orders SET status_id = ?, paid_at = ?, payment_resource_id = ?',
      ([status, paidAt, resource]) => {
        Object.assign(state.order, { status, paidAt, resource });
        return { affectedRows: 1 };
      },
    ],
    [
      'UPDATE products p JOIN order_items i',
      ([orderId]) => {
        state.sold.push(orderId);
        return { affectedRows: 1 };
      },
    ],
  ];
  async function query<Row>(
    text: string,
    params: readonly unknown[] = []
  ): Promise<Row[]> {
    sql.push(text);
    const handler = handlers.find(([opening]) => text.startsWith(opening));
    if (handler === undefined) throw new Error(`unexpected SQL: ${text}`);
    return handler[1](params as unknown[]) as Row[];
  }
  const db: Db & Transactional = {
    query,
    ping: async () => undefined,
    close: async () => undefined,
    transaction: <T>(work: (tx: TxQuery) => Promise<T>) => work({ query }),
  };
  return { db, sql, state };
}

const PAID: PaymentStatus = {
  paid: true,
  amountMxnCents: 200000,
  currency: 'MXN',
  orderNumber: ORDER,
  processorStatus: 'paid',
};

const STRIPE_EVENT: VerifiedEvent = {
  eventId: 'evt_1',
  type: 'checkout.session.completed',
  resourceId: 'cs_test_1',
};

function processor(
  event: VerifiedEvent | null = STRIPE_EVENT,
  payment: PaymentStatus | Error = PAID
) {
  const fetchPayment = vi.fn(async () => {
    if (payment instanceof Error) throw payment;
    return payment;
  });
  const port: PaymentProcessorPort = {
    createSession: vi.fn(),
    verifyWebhook: vi.fn(() => event),
    fetchPayment,
  };
  return { port, fetchPayment };
}

function deps(
  db: Db & Transactional,
  port: PaymentProcessorPort | undefined,
  mode: PaymentsConfig['mode'] = 'sandbox'
): WebhookDeps {
  return {
    db,
    processors: { STRIPE: port, MERCADO_PAGO: port },
    payments: {
      mode,
      siteUrl: 'https://yekora.mx',
      apiUrl: 'https://apiv1.yekora.mx',
      stripe: null,
      mercadoPago: null,
      checkout: null,
    },
    now: () => NOW,
  };
}

const INPUT = {
  rawBody: Buffer.from('{"id":"evt_1"}'),
  headers: { 'stripe-signature': 't=1,v1=x' },
  query: {},
};

describe('T1.3 · WebhookIngestionGate(V, N, R), in order V → N → R', () => {
  it('a processor without secrets answers 503 and reads nothing', async () => {
    const { db, sql } = webhookDb();
    await expect(
      receiveWebhook(deps(db, undefined), 'STRIPE', INPUT)
    ).resolves.toEqual({ status: 503, code: 'SERVICE_UNAVAILABLE' });
    expect(sql).toEqual([]);
  });

  it('V ⊥ (whatever N and R): 401 INVALID_SIGNATURE, order untouched, nothing read', async () => {
    const { db, sql, state } = webhookDb();
    const { port, fetchPayment } = processor(null);
    await expect(
      receiveWebhook(deps(db, port), 'STRIPE', INPUT)
    ).resolves.toEqual({ status: 401, code: 'INVALID_SIGNATURE' });
    expect(port.verifyWebhook).toHaveBeenCalledWith({ ...INPUT, now: NOW });
    expect(sql).toEqual([]);
    expect(fetchPayment).not.toHaveBeenCalled();
    expect(state.order.status).toBe(1);
  });

  it('V ⊤ N ⊥ (whatever R): 200 IDEMPOTENT_IGNORED without asking the processor', async () => {
    const { db, state } = webhookDb();
    state.events.push({ params: [1, 'evt_1'] });
    const { port, fetchPayment } = processor();
    await expect(
      receiveWebhook(deps(db, port), 'STRIPE', INPUT)
    ).resolves.toEqual({ status: 200, code: 'IDEMPOTENT_IGNORED' });
    expect(fetchPayment).not.toHaveBeenCalled();
    expect(state.events).toHaveLength(1);
  });

  it('the same event id at the other processor is a new event', async () => {
    const { db, state } = webhookDb();
    state.events.push({ params: [2, 'evt_1'] });
    const { port } = processor();
    await expect(
      receiveWebhook(deps(db, port), 'STRIPE', INPUT)
    ).resolves.toEqual({ status: 200, code: 'ORDER_PAID' });
  });

  it.each([
    [
      'a type that settles nothing',
      { ...STRIPE_EVENT, type: 'payment_intent.created' },
    ],
    ['no resource to ask about', { ...STRIPE_EVENT, resourceId: null }],
  ])(
    'V ⊤ N ⊤ R ⊥, %s: recorded, never fetched, no alert',
    async (_case, event) => {
      const { db, state } = webhookDb();
      const { port, fetchPayment } = processor(event);
      await expect(
        receiveWebhook(deps(db, port), 'STRIPE', INPUT)
      ).resolves.toEqual({ status: 200, code: 'PAYMENT_UNCONFIRMED' });
      expect(fetchPayment).not.toHaveBeenCalled();
      expect(state.events.map((e) => e.params)).toEqual([
        [1, 'evt_1', event.type, null, null, null, null, null, 0, 1],
      ]);
      expect(state.order.status).toBe(1);
    }
  );

  it('V ⊤ N ⊤ R ⊥, not paid yet (an OXXO voucher issued): recorded without alert', async () => {
    const { db, state } = webhookDb();
    const { port } = processor(STRIPE_EVENT, {
      ...PAID,
      paid: false,
      processorStatus: 'unpaid',
    });
    await expect(
      receiveWebhook(deps(db, port), 'STRIPE', INPUT)
    ).resolves.toEqual({ status: 200, code: 'PAYMENT_UNCONFIRMED' });
    expect(state.events[0].params.slice(3)).toEqual([
      7,
      'unpaid',
      200000,
      'MXN',
      null,
      0,
      1,
    ]);
    expect(state.order.status).toBe(1);
  });

  it.each([
    ['another amount', { amountMxnCents: 199999 }, 7],
    ['another currency', { currency: 'USD' }, 7],
    ['no amount', { amountMxnCents: null }, 7],
    ['an order that is not ours', { orderNumber: 'YEK-2026-ZZZZZZZZ' }, null],
    ['no order reference', { orderNumber: null }, null],
  ])(
    'V ⊤ N ⊤ R ⊥, paid with %s: recorded as an alert, order untouched',
    async (_case, over, orderId) => {
      const { db, state } = webhookDb();
      const { port } = processor(STRIPE_EVENT, { ...PAID, ...over });
      await expect(
        receiveWebhook(deps(db, port), 'STRIPE', INPUT)
      ).resolves.toEqual({ status: 200, code: 'PAYMENT_UNCONFIRMED' });
      expect(state.events[0].params[3]).toBe(orderId);
      expect(state.events[0].params[8]).toBe(1);
      expect(state.order).toMatchObject({ status: 1, resource: null });
    }
  );

  it('an order of the other processor does not reconcile', async () => {
    const { db, state } = webhookDb({ processorId: 2 });
    const { port } = processor();
    await expect(
      receiveWebhook(deps(db, port), 'STRIPE', INPUT)
    ).resolves.toEqual({ status: 200, code: 'PAYMENT_UNCONFIRMED' });
    expect(state.order.status).toBe(1);
  });

  it('cannot ask the processor: 503 and nothing recorded, so it retries', async () => {
    const { db, state } = webhookDb();
    const { port } = processor(STRIPE_EVENT, new Error('Stripe: HTTP 500'));
    await expect(
      receiveWebhook(deps(db, port), 'STRIPE', INPUT)
    ).resolves.toEqual({ status: 503, code: 'SERVICE_UNAVAILABLE' });
    expect(state.events).toEqual([]);
  });

  it('an unconfirmed event recorded first by another delivery is IDEMPOTENT_IGNORED', async () => {
    const { db } = webhookDb({}, DUPLICATE);
    const { port } = processor(STRIPE_EVENT, { ...PAID, paid: false });
    await expect(
      receiveWebhook(deps(db, port), 'STRIPE', INPUT)
    ).resolves.toEqual({ status: 200, code: 'IDEMPOTENT_IGNORED' });
  });
});

describe('T1.4 applied to the order (V ∧ N ∧ R)', () => {
  it('P: PENDING → PAID, with its payment and paid time, and the reserved units sold', async () => {
    const { db, state } = webhookDb();
    const { port } = processor();
    await expect(
      receiveWebhook(deps(db, port), 'STRIPE', INPUT)
    ).resolves.toEqual({ status: 200, code: 'ORDER_PAID' });
    expect(state.order).toMatchObject({
      status: 2,
      resource: 'cs_test_1',
      paidAt: NOW,
    });
    expect(state.sold).toEqual([7]);
    expect(state.events[0].params.slice(3)).toEqual([
      7,
      'paid',
      200000,
      'MXN',
      2,
      0,
      1,
    ]);
  });

  it('S: the same payment again (a retry or a second notification) → ALREADY_PAID, nothing moves', async () => {
    const { db, state } = webhookDb({
      status: 2,
      resource: 'cs_test_1',
      paidAt: NOW,
    });
    const { port } = processor({ ...STRIPE_EVENT, eventId: 'evt_2' });
    await expect(
      receiveWebhook(deps(db, port), 'STRIPE', INPUT)
    ).resolves.toEqual({ status: 200, code: 'ALREADY_PAID' });
    expect(state.sold).toEqual([]);
    expect(state.events[0].params.slice(7)).toEqual([2, 0, 1]);
  });

  it.each([
    ['EXPIRED', 3],
    ['CANCELLED', 4],
  ])(
    'E: a payment for an order %s → NEEDS_REVIEW with an alert, never PAID',
    async (_s, status) => {
      const { db, state } = webhookDb({ status });
      const { port } = processor();
      await expect(
        receiveWebhook(deps(db, port), 'STRIPE', INPUT)
      ).resolves.toEqual({ status: 200, code: 'LATE_PAYMENT_NEEDS_REVIEW' });
      expect(state.order).toMatchObject({ status: 6, resource: 'cs_test_1' });
      expect(state.sold).toEqual([]);
      expect(state.events[0].params.slice(7)).toEqual([6, 1, 1]);
    }
  );

  it.each([
    ['PAID by another payment', { status: 2, resource: 'cs_test_0' }],
    ['REFUNDED', { status: 5, resource: 'cs_test_0' }],
    ['already in NEEDS_REVIEW', { status: 6, resource: null }],
  ])(
    'none of them, %s → PAYMENT_NEEDS_REVIEW_ALERT, order untouched',
    async (_s, order) => {
      const { db, state } = webhookDb(order);
      const { port } = processor();
      await expect(
        receiveWebhook(deps(db, port), 'STRIPE', INPUT)
      ).resolves.toEqual({ status: 200, code: 'PAYMENT_NEEDS_REVIEW_ALERT' });
      expect(state.order).toMatchObject(order);
      expect(state.sold).toEqual([]);
      expect(state.events[0].params.slice(7)).toEqual([order.status, 1, 1]);
    }
  );

  it('two deliveries of one event at once: the one that loses the insert changes nothing', async () => {
    const { db, state } = webhookDb({}, DUPLICATE);
    const { port } = processor();
    await expect(
      receiveWebhook(deps(db, port), 'STRIPE', INPUT)
    ).resolves.toEqual({ status: 200, code: 'IDEMPOTENT_IGNORED' });
    expect(state.order.status).toBe(1);
    expect(state.sold).toEqual([]);
  });

  it('lets any other database error surface', async () => {
    const { db } = webhookDb({}, new Error('connection lost'));
    const { port } = processor();
    await expect(
      receiveWebhook(deps(db, port), 'STRIPE', INPUT)
    ).rejects.toThrow('connection lost');
  });

  it('Mercado Pago payments settle orders of processor 2; live events are not tests', async () => {
    const { db, state } = webhookDb({ processorId: 2 });
    const { port } = processor({
      eventId: '123',
      type: 'payment',
      resourceId: '987',
    });
    await expect(
      receiveWebhook(deps(db, port, 'live'), 'MERCADO_PAGO', INPUT)
    ).resolves.toEqual({ status: 200, code: 'ORDER_PAID' });
    expect(state.order.resource).toBe('987');
    expect(state.events[0].params.slice(0, 3)).toEqual([2, '123', 'payment']);
    expect(state.events[0].params[9]).toBe(0);
  });

  it.each([
    ['checkout.session.async_payment_succeeded'],
    ['checkout.session.completed'],
  ])('Stripe %s can settle', async (type) => {
    const { db } = webhookDb();
    const { port } = processor({ ...STRIPE_EVENT, type });
    expect((await receiveWebhook(deps(db, port), 'STRIPE', INPUT)).code).toBe(
      'ORDER_PAID'
    );
  });
});
