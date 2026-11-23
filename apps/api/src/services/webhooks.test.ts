import { describe, expect, it, vi } from 'vitest';
import type { PaymentsConfig } from '../config';
import type { Db, Transactional, TxQuery } from './db';
import type {
  PaymentProcessorPort,
  PaymentStatus,
  RefundStatus,
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
    /** Orders whose units went back to the stock (FC 069). */
    restocked: [] as unknown[],
    /** The audit entries the receiver wrote (FC 069): their action. */
    audit: [] as unknown[],
    /** The rows of `outbox_events` the receiver queued (FC 066): event type and payload. */
    outbox: [] as { type: string; payload: Record<string, unknown> }[],
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
      'SELECT o.id, o.order_number, o.total_mxn_cents FROM orders o',
      ([number, processorId, resource]) =>
        number === state.order.number &&
        processorId === state.order.processorId &&
        resource === state.order.resource
          ? [
              {
                id: state.order.id,
                order_number: state.order.number,
                total_mxn_cents: String(state.order.total),
              },
            ]
          : [],
    ],
    [
      'SELECT status_id FROM orders',
      () => [{ status_id: String(state.order.status) }],
    ],
    [
      'UPDATE orders SET status_id = ? WHERE id = ?',
      ([status]) => {
        state.order.status = status as number;
        return { affectedRows: 1 };
      },
    ],
    [
      'UPDATE products p JOIN order_items i ON i.product_id = p.id SET p.stock = p.stock + i.quantity',
      ([orderId]) => {
        state.restocked.push(orderId);
        return { affectedRows: 1 };
      },
    ],
    [
      'INSERT INTO audit_log',
      (p) => {
        state.audit.push(p[1]);
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
    [
      'INSERT INTO outbox_events',
      ([type, payload]) => {
        state.outbox.push({
          type: type as string,
          payload: JSON.parse(payload as string),
        });
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
    ping: async () => true,
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
    // FC 066 T1.2, T2.4: the confirmation is queued in the same transaction, with only the id.
    expect(state.outbox).toEqual([
      { type: 'ORDER_CONFIRMED', payload: { orderId: 7 } },
    ]);
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
    // FC 066 T2.1: a payment already settled queues no second confirmation.
    expect(state.outbox).toEqual([]);
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
      // FC 066 T1.2: a late payment is for a person to review, not a confirmation.
      expect(state.outbox).toEqual([]);
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

describe('FC 069 · a refunded charge (T1.1, T1.2, T1.3)', () => {
  const REFUND_EVENT: VerifiedEvent = {
    eventId: 'evt_refund_1',
    type: 'charge.refunded',
    resourceId: 'ch_1',
  };
  const WHOLE: RefundStatus = {
    sessionId: 'cs_test_1',
    orderNumber: ORDER,
    amountMxnCents: 200000,
    refundedMxnCents: 200000,
    currency: 'MXN',
  };
  /** A processor that reads the refund back as `refund`, or fails when it is an Error. */
  function refunding(
    refund: RefundStatus | null | Error = WHOLE,
    event: VerifiedEvent = REFUND_EVENT
  ) {
    const fetchRefund = vi.fn(async () => {
      if (refund instanceof Error) throw refund;
      return refund;
    });
    const port: PaymentProcessorPort = {
      createSession: vi.fn(),
      verifyWebhook: vi.fn(() => event),
      fetchPayment: vi.fn(),
      fetchRefund,
      ping: async () => true,
    };
    return { port, fetchRefund };
  }
  const paidOrder = (status: number) => ({ status, resource: 'cs_test_1' });

  it.each([[2], [7]])(
    'a whole refund of an order in status %i: REFUNDED, units back, one notice, one audit, paid_at kept',
    async (status) => {
      const paidAt = new Date('2026-10-20T10:00:00Z');
      const { db, state } = webhookDb({ ...paidOrder(status), paidAt });
      const { port, fetchRefund } = refunding();
      await expect(
        receiveWebhook(deps(db, port), 'STRIPE', INPUT)
      ).resolves.toEqual({ status: 200, code: 'REFUND_PROCESSED' });
      expect(fetchRefund).toHaveBeenCalledWith('ch_1');
      expect(state.order.status).toBe(5);
      expect(state.order.paidAt).toBe(paidAt);
      expect(state.restocked).toEqual([7]);
      expect(state.outbox).toEqual([
        { type: 'ORDER_REFUNDED', payload: { orderId: 7 } },
      ]);
      expect(state.audit).toEqual(['ORDER_REFUNDED']);
      expect(state.events[0].params.slice(0, 3)).toEqual([
        1,
        'evt_refund_1',
        'charge.refunded',
      ]);
      expect(state.events[0].params.slice(7, 9)).toEqual([5, 0]);
    }
  );

  it.each([[8], [9]])(
    'an order in status %i left the warehouse: REFUNDED but the stock is not touched (K-80)',
    async (status) => {
      const { db, state } = webhookDb(paidOrder(status));
      const { port } = refunding();
      await expect(
        receiveWebhook(deps(db, port), 'STRIPE', INPUT)
      ).resolves.toEqual({ status: 200, code: 'REFUND_PROCESSED' });
      expect(state.order.status).toBe(5);
      expect(state.restocked).toEqual([]);
      expect(state.outbox).toHaveLength(1);
    }
  );

  it('an order that is already REFUNDED changes nothing: IDEMPOTENT_IGNORED, no notice', async () => {
    const { db, state } = webhookDb(paidOrder(5));
    const { port } = refunding();
    await expect(
      receiveWebhook(deps(db, port), 'STRIPE', INPUT)
    ).resolves.toEqual({ status: 200, code: 'IDEMPOTENT_IGNORED' });
    expect(state.restocked).toEqual([]);
    expect(state.outbox).toEqual([]);
    expect(state.audit).toEqual([]);
    expect(state.events).toHaveLength(1);
  });

  it.each([[1], [3], [4], [6]])(
    'an order in status %i was never paid: 500 REFUND_STATUS_CONFLICT_ANOMALY, alert, nothing moves',
    async (status) => {
      const { db, state } = webhookDb(paidOrder(status));
      const { port } = refunding();
      await expect(
        receiveWebhook(deps(db, port), 'STRIPE', INPUT)
      ).resolves.toEqual({
        status: 500,
        code: 'REFUND_STATUS_CONFLICT_ANOMALY',
      });
      expect(state.order.status).toBe(status);
      expect(state.restocked).toEqual([]);
      expect(state.outbox).toEqual([]);
      expect(state.events[0].params.slice(7, 9)).toEqual([status, 1]);
    }
  );

  it('a partial refund is an alert and changes nothing', async () => {
    const { db, state } = webhookDb(paidOrder(2));
    const { port } = refunding({ ...WHOLE, refundedMxnCents: 50000 });
    await expect(
      receiveWebhook(deps(db, port), 'STRIPE', INPUT)
    ).resolves.toEqual({ status: 200, code: 'PARTIAL_REFUND_ALERT' });
    expect(state.order.status).toBe(2);
    expect(state.outbox).toEqual([]);
    expect(state.events[0].params.slice(7, 9)).toEqual([null, 1]);
  });

  it.each([
    ['another order number', { orderNumber: 'YEK-2026-ZZZZZZZZ' }],
    ['another session', { sessionId: 'cs_other' }],
    ['another amount', { amountMxnCents: 100 }],
    ['another currency', { currency: 'USD' }],
  ])(
    'a charge with %s is unreconciled: alert, nothing moves',
    async (_name, over) => {
      const { db, state } = webhookDb(paidOrder(2));
      const { port } = refunding({ ...WHOLE, ...over });
      await expect(
        receiveWebhook(deps(db, port), 'STRIPE', INPUT)
      ).resolves.toEqual({ status: 200, code: 'REFUND_UNRECONCILED_ALERT' });
      expect(state.order.status).toBe(2);
      expect(state.events[0].params.slice(7, 9)).toEqual([null, 1]);
    }
  );

  it('a charge with no session of ours is unreconciled', async () => {
    const { db, state } = webhookDb(paidOrder(2));
    const { port } = refunding(null);
    await expect(
      receiveWebhook(deps(db, port), 'STRIPE', INPUT)
    ).resolves.toEqual({ status: 200, code: 'REFUND_UNRECONCILED_ALERT' });
    expect(state.order.status).toBe(2);
    expect(state.events).toHaveLength(1);
  });

  it('an event without a charge is unreconciled, and the processor is not asked', async () => {
    const { db, state } = webhookDb(paidOrder(2));
    const { port, fetchRefund } = refunding(WHOLE, {
      ...REFUND_EVENT,
      resourceId: null,
    });
    await expect(
      receiveWebhook(deps(db, port), 'STRIPE', INPUT)
    ).resolves.toEqual({ status: 200, code: 'REFUND_UNRECONCILED_ALERT' });
    expect(fetchRefund).not.toHaveBeenCalled();
    expect(state.events).toHaveLength(1);
  });

  it('a processor that cannot read refunds back leaves an alert', async () => {
    const { db, state } = webhookDb(paidOrder(2));
    const { port } = refunding();
    delete port.fetchRefund;
    await expect(
      receiveWebhook(deps(db, port), 'STRIPE', INPUT)
    ).resolves.toEqual({ status: 200, code: 'REFUND_UNRECONCILED_ALERT' });
    expect(state.events).toHaveLength(1);
  });

  it('cannot ask the processor: 503 and nothing recorded, so it retries', async () => {
    const { db, state } = webhookDb(paidOrder(2));
    const { port } = refunding(new Error('timeout'));
    await expect(
      receiveWebhook(deps(db, port), 'STRIPE', INPUT)
    ).resolves.toEqual({ status: 503, code: 'SERVICE_UNAVAILABLE' });
    expect(state.events).toEqual([]);
  });

  it('the same refund event delivered twice: the second is IDEMPOTENT_IGNORED', async () => {
    const { db, state } = webhookDb(paidOrder(2));
    const { port, fetchRefund } = refunding();
    await receiveWebhook(deps(db, port), 'STRIPE', INPUT);
    await expect(
      receiveWebhook(deps(db, port), 'STRIPE', INPUT)
    ).resolves.toEqual({ status: 200, code: 'IDEMPOTENT_IGNORED' });
    expect(fetchRefund).toHaveBeenCalledTimes(1);
    expect(state.outbox).toHaveLength(1);
  });

  it.each([
    ['whole', WHOLE],
    ['partial', { ...WHOLE, refundedMxnCents: 1 }],
    ['unreconciled', null],
  ])(
    'two deliveries at once, %s: the one that loses the insert changes nothing',
    async (_name, refund) => {
      const { db, state } = webhookDb(paidOrder(2), DUPLICATE);
      const { port } = refunding(refund);
      await expect(
        receiveWebhook(deps(db, port), 'STRIPE', INPUT)
      ).resolves.toEqual({ status: 200, code: 'IDEMPOTENT_IGNORED' });
      expect(state.outbox).toEqual([]);
      expect(state.restocked).toEqual([]);
    }
  );

  it('Mercado Pago has no refund events: a charge.refunded there is not read as one', async () => {
    const { db, state } = webhookDb({ processorId: 2, ...paidOrder(2) });
    const { port, fetchRefund } = refunding();
    await receiveWebhook(deps(db, port), 'MERCADO_PAGO', INPUT);
    expect(fetchRefund).not.toHaveBeenCalled();
    expect(state.order.status).toBe(2);
  });
});
