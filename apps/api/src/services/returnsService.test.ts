/**
 * FC 071 evidence of the returns: the gate of four eyes (T1.2, T2.1), the balance of the order
 * (T2.2), the condition of the stock (T2.3), intent → call → close with the processor (T2.4) and
 * the link with the refund webhook of FC 069.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Db, Transactional } from './db';
import {
  PaymentProcessorError,
  type PaymentProcessorPort,
} from './paymentPort';
import { decideConfirmation } from './returnsEligibility';
import {
  confirmReturn,
  isReturnRefund,
  listReturns,
  prepareReturn,
  readProcessorRefunded,
  requestReturn,
  RETURN_REFUSALS,
} from './returnsService';

const NOW = new Date('2026-11-23T18:00:00.000Z');
const DELIVERED = new Date('2026-11-01T12:00:00.000Z');
const ACTOR = { userId: 'user-1', ip: '203.0.113.9' };

/** What the fake database answers; every test sets what it needs. */
interface Scenario {
  order: Record<string, unknown> | null;
  lines: Record<string, unknown>[];
  row: Record<string, unknown> | null;
  rows: Record<string, unknown>[];
  total: number;
  committed: number;
  /** What the requests already REFUNDED here add up to (the part of the processor's total that is ours). */
  ours: number;
  /** The order's processor and payment, as the read of the processor needs them. */
  target: Record<string, unknown> | null;
  prep: Record<string, unknown> | null;
  begin: Record<string, unknown> | null;
  fin: Record<string, unknown>;
  orderNow: Record<string, unknown>;
  counts: { known: number; inFlight: number };
}

const VIEW_ROW = {
  id: 5,
  order_number: 'YEK-2026-ABCD1234',
  status: 'REQUESTED',
  reason: 'DEFECT',
  comment: null,
  refund_mxn_cents: null,
  restock: null,
  created_at: NOW,
  prepared_at: null,
  confirmed_at: null,
};

function scenario(over: Partial<Scenario> = {}): Scenario {
  return {
    order: {
      id: 7,
      user_id: 'buyer-1',
      status_id: 9,
      delivered_at: DELIVERED,
    },
    lines: [
      { id: 11, sku: 'TENT', quantity: 2, allows_return: 1, returned: 0 },
      { id: 12, sku: 'LAMP', quantity: 1, allows_return: 0, returned: '0' },
    ],
    row: VIEW_ROW,
    rows: [VIEW_ROW],
    total: 1,
    committed: 0,
    ours: 0,
    target: { processor_code: 'STRIPE', payment_resource_id: 'cs_test_1' },
    prep: { order_id: 7, status: 'REQUESTED', total_mxn_cents: '200000' },
    begin: null,
    fin: { status: 'REFUNDING', restock: 1 },
    orderNow: { status_id: 9, total_mxn_cents: '200000' },
    counts: { known: 0, inFlight: 0 },
    ...over,
  };
}

/** A database that answers from the scenario and keeps what was written. */
function fakeDb(s: Scenario) {
  const log: { sql: string; params: readonly unknown[] }[] = [];
  const routes: [string, (p: readonly unknown[]) => unknown][] = [
    [
      'SELECT id, user_id, status_id, delivered_at FROM orders',
      () => (s.order ? [s.order] : []),
    ],
    ['SELECT i.id, i.sku', () => s.lines],
    ['INSERT INTO order_returns', () => ({ insertId: 5 })],
    ['INSERT INTO order_return_items', () => ({ affectedRows: 1 })],
    ['INSERT INTO audit_log', () => ({ affectedRows: 1 })],
    ['INSERT INTO outbox_events', () => ({ affectedRows: 1 })],
    [
      'SELECT ri.return_id',
      () => [
        { return_id: 5, sku: 'TENT', quantity: '1' },
        { return_id: 6, sku: 'LAMP', quantity: 1 },
      ],
    ],
    [
      'SELECT r.id, o.order_number, r.status',
      (p) => {
        if (p.length !== 1) return s.rows;
        return s.row ? [s.row] : [];
      },
    ],
    [
      'SELECT COUNT(*) AS n FROM order_returns WHERE (? IS NULL',
      () => [{ n: s.total }],
    ],
    [
      "SELECT COALESCE(SUM(refund_mxn_cents), 0) AS n FROM order_returns WHERE order_id = ? AND status = 'REFUNDED'",
      () => [{ n: String(s.ours) }],
    ],
    ['SELECT COALESCE(SUM', () => [{ n: String(s.committed) }]],
    [
      'SELECT p.code AS processor_code, o.payment_resource_id',
      () => (s.target ? [s.target] : []),
    ],
    ['SELECT r.order_id, r.status', () => (s.prep ? [s.prep] : [])],
    ['SELECT r.order_id, o.order_number', () => (s.begin ? [s.begin] : [])],
    ['SELECT status, restock FROM order_returns', () => [s.fin]],
    ['SELECT status_id, total_mxn_cents FROM orders', () => [s.orderNow]],
    [
      'SELECT COUNT(*) AS n FROM order_returns WHERE order_id = ? AND processor_refund_id',
      () => [{ n: s.counts.known }],
    ],
    [
      "SELECT COUNT(*) AS n FROM order_returns WHERE order_id = ? AND status = 'REFUNDING'",
      () => [{ n: s.counts.inFlight }],
    ],
  ];
  async function query<Row>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<Row[]> {
    log.push({ sql, params });
    const route = routes.find(([opening]) => sql.startsWith(opening));
    return (route ? route[1](params) : { affectedRows: 1 }) as Row[];
  }
  const db = {
    query,
    ping: async () => undefined,
    close: async () => undefined,
    transaction: (work: (tx: Pick<Db, 'query'>) => Promise<unknown>) =>
      work({ query }),
  } as unknown as Db & Transactional;
  const wrote = (opening: string) =>
    log.filter((entry) => entry.sql.startsWith(opening));
  return { db, log, wrote };
}

/** The first condition that fails names the row; each condition has its own code. */
function expectedCode(held: boolean[]): string {
  const codes = [
    'RETURN_NOT_PREPARED_REJECT',
    'UNAUTHORIZED_CONFIRMER_REJECT',
    'DUAL_CONTROL_VIOLATION_REJECT',
    'INVALID_REFUND_AMOUNT_REJECT',
  ];
  const failed = held.findIndex((holds) => !holds);
  return failed === -1 ? 'REFUND_CONFIRMED_EXECUTE' : codes[failed];
}

describe('T1.2 · DualControlRefundConfirmationGate(P, C, D, M), the 16 rows', () => {
  const rows = Array.from({ length: 16 }, (_unused, index) => {
    const [prepared, authorized, different, amountOk] = [3, 2, 1, 0].map(
      (shift) => ((index >> shift) & 1) === 0
    );
    const code = expectedCode([prepared, authorized, different, amountOk]);
    return {
      label: [prepared, authorized, different, amountOk]
        .map((bit) => (bit ? '⊤' : '⊥'))
        .join(''),
      inputs: { prepared, authorized, samePerson: !different, amountOk },
      code,
    };
  });

  it.each(rows)('$label → $code', ({ inputs, code }) => {
    expect(decideConfirmation(inputs)).toBe(code);
  });

  it('executes in exactly one row', () => {
    expect(
      rows.filter((row) => row.code === 'REFUND_CONFIRMED_EXECUTE')
    ).toHaveLength(1);
  });
});

describe('RETURN_REFUSALS', () => {
  it('gives every refusal an HTTP status and a title', () => {
    for (const [status, title] of Object.values(RETURN_REFUSALS)) {
      expect(status).toBeGreaterThanOrEqual(400);
      expect(title).not.toBe('');
    }
  });
});

describe('requestReturn (T1.1 on every line)', () => {
  const ask = (
    s: Scenario,
    items: { sku: string; quantity: number }[],
    userId = 'buyer-1',
    comment?: string
  ) => {
    const harness = fakeDb(s);
    return {
      harness,
      result: requestReturn(
        harness.db,
        {
          orderNumber: 'YEK-2026-ABCD1234',
          userId,
          request: { items, reason: 'DEFECT', comment },
          now: NOW,
        },
        ACTOR
      ),
    };
  };

  it('creates the request with its lines and audits it', async () => {
    const { harness, result } = ask(scenario(), [{ sku: 'TENT', quantity: 2 }]);
    await expect(result).resolves.toMatchObject({
      id: 5,
      orderNumber: 'YEK-2026-ABCD1234',
      status: 'REQUESTED',
      reason: 'DEFECT',
      items: [{ sku: 'TENT', quantity: 1 }],
      refundMxnCents: null,
      restock: null,
      preparedAt: null,
      confirmedAt: null,
    });
    expect(harness.wrote('INSERT INTO order_returns')[0].params).toEqual([
      7,
      'DEFECT',
      null,
      'buyer-1',
    ]);
    expect(harness.wrote('INSERT INTO order_return_items')[0].params).toEqual([
      [[5, 11, 2]],
    ]);
    expect(harness.wrote('INSERT INTO audit_log')[0].params).toContain(
      'RETURN_REQUESTED'
    );
  });

  it('keeps a comment and turns an empty one into nothing', async () => {
    const withComment = ask(
      scenario(),
      [{ sku: 'TENT', quantity: 1 }],
      'buyer-1',
      'Se rompió'
    );
    await withComment.result;
    expect(
      withComment.harness.wrote('INSERT INTO order_returns')[0].params[2]
    ).toBe('Se rompió');
    const empty = ask(
      scenario(),
      [{ sku: 'TENT', quantity: 1 }],
      'buyer-1',
      ''
    );
    await empty.result;
    expect(
      empty.harness.wrote('INSERT INTO order_returns')[0].params[2]
    ).toBeNull();
  });

  it('counts the units already asked for: 2 bought, 1 returned, 2 asked is refused', async () => {
    const s = scenario({
      lines: [
        { id: 11, sku: 'TENT', quantity: 2, allows_return: 1, returned: '1' },
      ],
    });
    await expect(ask(s, [{ sku: 'TENT', quantity: 2 }]).result).resolves.toBe(
      'INVALID_QUANTITY_REJECT'
    );
    await expect(
      ask(s, [{ sku: 'TENT', quantity: 1 }]).result
    ).resolves.toMatchObject({
      status: 'REQUESTED',
    });
  });

  it.each([
    ['an order that does not exist', { order: null }, 'ORDER_NOT_FOUND'],
    [
      'an order that is not delivered',
      {
        order: { id: 7, user_id: 'buyer-1', status_id: 8, delivered_at: null },
      },
      'ORDER_NOT_DELIVERED_REJECT',
    ],
    [
      'an order whose window of 60 days is over',
      {
        order: {
          id: 7,
          user_id: 'buyer-1',
          status_id: 9,
          delivered_at: new Date('2026-09-01T00:00:00.000Z'),
        },
      },
      'WINDOW_EXPIRED_REJECT',
    ],
  ])('refuses %s', async (_name, over, code) => {
    await expect(
      ask(scenario(over as Partial<Scenario>), [{ sku: 'TENT', quantity: 1 }])
        .result
    ).resolves.toBe(code);
  });

  it('refuses another buyer’s order and a guest purchase with DATA_DOMAIN_FORBIDDEN, even for an unknown SKU', async () => {
    await expect(
      ask(scenario(), [{ sku: 'TENT', quantity: 1 }], 'someone-else').result
    ).resolves.toBe('DATA_DOMAIN_FORBIDDEN');
    await expect(
      ask(scenario(), [{ sku: 'NOPE', quantity: 1 }], 'someone-else').result
    ).resolves.toBe('DATA_DOMAIN_FORBIDDEN');
    await expect(
      ask(
        scenario({
          order: {
            id: 7,
            user_id: null,
            status_id: 9,
            delivered_at: DELIVERED,
          },
        }),
        [{ sku: 'TENT', quantity: 1 }]
      ).result
    ).resolves.toBe('DATA_DOMAIN_FORBIDDEN');
  });

  it('refuses a product that did not allow returns when it was bought', async () => {
    await expect(
      ask(scenario(), [{ sku: 'LAMP', quantity: 1 }]).result
    ).resolves.toBe('PRODUCT_NON_RETURNABLE_REJECT');
  });

  it('refuses an SKU the order lacks and a line asked twice', async () => {
    await expect(
      ask(scenario(), [{ sku: 'NOPE', quantity: 1 }]).result
    ).resolves.toBe('RETURN_PAYLOAD_INVALID');
    await expect(
      ask(scenario(), [
        { sku: 'TENT', quantity: 1 },
        { sku: 'TENT', quantity: 1 },
      ]).result
    ).resolves.toBe('RETURN_PAYLOAD_INVALID');
  });

  it('refuses the whole request when one line fails, and writes nothing', async () => {
    const { harness, result } = ask(scenario(), [
      { sku: 'TENT', quantity: 1 },
      { sku: 'LAMP', quantity: 1 },
    ]);
    await expect(result).resolves.toBe('PRODUCT_NON_RETURNABLE_REJECT');
    expect(harness.wrote('INSERT')).toEqual([]);
  });
});

describe('listReturns', () => {
  it('lists the requests with their lines and the total of the filter', async () => {
    const { db, log } = fakeDb(
      scenario({
        rows: [
          {
            ...VIEW_ROW,
            id: 5,
            status: 'PREPARED',
            refund_mxn_cents: '45000',
            restock: 1,
            prepared_at: NOW,
          },
          {
            ...VIEW_ROW,
            id: 6,
            comment: 'nota',
            restock: 0,
            confirmed_at: NOW,
          },
        ],
        total: 2,
      })
    );
    const board = await listReturns(db, 'PREPARED');
    expect(board.total).toBe(2);
    expect(board.items.map((item) => [item.id, item.items])).toEqual([
      [5, [{ sku: 'TENT', quantity: 1 }]],
      [6, [{ sku: 'LAMP', quantity: 1 }]],
    ]);
    expect(board.items[0]).toMatchObject({
      refundMxnCents: 45000,
      restock: true,
      preparedAt: NOW.toISOString(),
    });
    expect(board.items[1]).toMatchObject({ comment: 'nota', restock: false });
    expect(log[0].params).toEqual(['PREPARED', 'PREPARED']);
  });

  it('answers an empty board without asking for lines', async () => {
    const { db, log } = fakeDb(scenario({ rows: [], total: 0 }));
    await expect(listReturns(db, null)).resolves.toEqual({
      items: [],
      total: 0,
    });
    expect(
      log.some((entry) => entry.sql.startsWith('SELECT ri.return_id'))
    ).toBe(false);
  });
});

describe('prepareReturn (T2.2 balance)', () => {
  const prepare = (
    s: Scenario,
    refundMxnCents = 45000,
    restock = true,
    processorRefundedCents = 0
  ) => {
    const harness = fakeDb(s);
    return {
      harness,
      result: prepareReturn(
        harness.db,
        5,
        { refundMxnCents, restock, processorRefundedCents },
        ACTOR,
        NOW
      ),
    };
  };

  it('sets the amount, the restock decision and the preparer, and audits it', async () => {
    const { harness, result } = prepare(scenario());
    await expect(result).resolves.toMatchObject({ id: 5 });
    expect(
      harness.wrote("UPDATE order_returns SET status = 'PREPARED'")[0].params
    ).toEqual([45000, 1, 'user-1', NOW, 5]);
    expect(harness.wrote('INSERT INTO audit_log')[0].params).toContain(
      'RETURN_PREPARED'
    );
  });

  it('records that the units are not coming back to the shelf', async () => {
    const { harness, result } = prepare(scenario(), 45000, false);
    await result;
    expect(
      harness.wrote("UPDATE order_returns SET status = 'PREPARED'")[0].params[1]
    ).toBe(0);
  });

  it('accepts exactly what is left of the order and refuses one cent more', async () => {
    const s = scenario({ committed: 155000 });
    await expect(prepare(s, 45000).result).resolves.toMatchObject({ id: 5 });
    await expect(prepare(s, 45001).result).resolves.toBe(
      'INVALID_REFUND_AMOUNT_REJECT'
    );
  });

  it('counts what the processor refunded outside the store (T2.2): the part no request of ours explains', async () => {
    const s = scenario({ ours: 30000 });
    // The processor says 130 000 are refunded; 30 000 are our requests, so 100 000 are outside.
    await expect(
      prepare(s, 100000, true, 130000).result
    ).resolves.toMatchObject({
      status: 'REQUESTED',
    });
    await expect(prepare(s, 100001, true, 130000).result).resolves.toBe(
      'INVALID_REFUND_AMOUNT_REJECT'
    );
  });

  it('never counts less than nothing when the requests here refunded more than the processor reports', async () => {
    const s = scenario({ ours: 90000 });
    await expect(prepare(s, 200000, true, 50000).result).resolves.toMatchObject(
      {
        status: 'REQUESTED',
      }
    );
  });

  it('refuses a request that does not exist and one that is not waiting to be prepared', async () => {
    await expect(prepare(scenario({ prep: null })).result).resolves.toBe(
      'RETURN_NOT_FOUND'
    );
    await expect(
      prepare(
        scenario({
          prep: { order_id: 7, status: 'PREPARED', total_mxn_cents: 200000 },
        })
      ).result
    ).resolves.toBe('RETURN_STATUS_CONFLICT');
  });
});

describe('confirmReturn (T1.2, T2.1, T2.2, T2.3, T2.4)', () => {
  const BEGIN = {
    order_id: 7,
    order_number: 'YEK-2026-ABCD1234',
    status: 'PREPARED',
    prepared_by: 'user-1',
    refund_mxn_cents: 45000,
    total_mxn_cents: '200000',
    payment_resource_id: 'cs_test_1',
    processor_code: 'STRIPE',
  };
  const CONFIRMER: {
    userId: string;
    canConfirm: boolean;
    manualReference: string | null;
  } = {
    userId: 'user-2',
    canConfirm: true,
    manualReference: null,
  };

  function stripe(createRefund?: PaymentProcessorPort['createRefund']) {
    return { createRefund } as unknown as PaymentProcessorPort;
  }

  function run(
    over: Partial<Scenario>,
    processors: Parameters<typeof confirmReturn>[0]['processors'],
    confirmer = CONFIRMER
  ) {
    const harness = fakeDb(scenario({ begin: BEGIN, ...over }));
    return {
      harness,
      result: confirmReturn(
        { db: harness.db, processors, now: () => NOW },
        5,
        confirmer,
        '203.0.113.9'
      ),
    };
  }

  it('records the intent, asks Stripe once with the key of the request, then closes: stock back, notice queued', async () => {
    const createRefund = vi.fn(async () => ({ refundId: 're_1' }));
    const { harness, result } = run({}, { STRIPE: stripe(createRefund) });
    const answer = await result;
    expect(answer.status).toBe(200);
    expect(createRefund).toHaveBeenCalledOnce();
    expect(createRefund).toHaveBeenCalledWith({
      paymentResourceId: 'cs_test_1',
      amountMxnCents: 45000,
      idempotencyKey: 'yekora-return-5',
    });
    const order = harness.log.map((entry) => entry.sql);
    const intent = order.findIndex((sql) =>
      sql.startsWith("UPDATE order_returns SET status = 'REFUNDING'")
    );
    const closed = order.findIndex((sql) =>
      sql.startsWith("UPDATE order_returns SET status = 'REFUNDED'")
    );
    expect(intent).toBeGreaterThan(-1);
    expect(closed).toBeGreaterThan(intent);
    expect(
      harness.wrote("UPDATE order_returns SET status = 'REFUNDING'")[0].params
    ).toEqual(['user-2', NOW, 5]);
    expect(
      harness.wrote("UPDATE order_returns SET status = 'REFUNDED'")[0].params
    ).toEqual(['re_1', null, 5]);
    expect(harness.wrote('UPDATE products p')[0].params).toEqual([5]);
    expect(harness.wrote('INSERT INTO outbox_events')[0].params[0]).toBe(
      'RETURN_REFUNDED'
    );
    expect(
      JSON.parse(
        String(harness.wrote('INSERT INTO outbox_events')[0].params[1])
      )
    ).toEqual({
      orderId: 7,
      refundMxnCents: 45000,
    });
    // A partial refund leaves the order as it is.
    expect(harness.wrote('UPDATE orders SET status_id')).toEqual([]);
  });

  it('moves the order to REFUNDED when the refunds add up to its total (T2.2)', async () => {
    const createRefund = vi.fn(async () => ({ refundId: 're_2' }));
    const { harness } = run(
      { begin: { ...BEGIN, refund_mxn_cents: 45000 }, committed: 155000 },
      { STRIPE: stripe(createRefund) }
    );
    const answer = await confirmReturnAgain(harness, createRefund);
    expect(answer.status).toBe(200);
    expect(harness.wrote('UPDATE orders SET status_id')[0].params).toEqual([
      5, 7,
    ]);
  });

  async function confirmReturnAgain(
    harness: ReturnType<typeof fakeDb>,
    createRefund: PaymentProcessorPort['createRefund']
  ) {
    return confirmReturn(
      {
        db: harness.db,
        processors: { STRIPE: stripe(createRefund) },
        now: () => NOW,
      },
      5,
      CONFIRMER,
      null
    );
  }

  it('leaves an order that is not in a paid status alone, even when the refunds add up', async () => {
    const createRefund = vi.fn(async () => ({ refundId: 're_3' }));
    const { harness, result } = run(
      {
        committed: 155000,
        orderNow: { status_id: 5, total_mxn_cents: '200000' },
      },
      { STRIPE: stripe(createRefund) }
    );
    await result;
    expect(harness.wrote('UPDATE orders SET status_id')).toEqual([]);
  });

  it('does not touch the stock when the operator said the units are not coming back', async () => {
    const createRefund = vi.fn(async () => ({ refundId: 're_4' }));
    const { harness, result } = run(
      { fin: { status: 'REFUNDING', restock: 0 } },
      { STRIPE: stripe(createRefund) }
    );
    await result;
    expect(harness.wrote('UPDATE products p')).toEqual([]);
  });

  it('retries a request that stayed REFUNDING: the same key reaches the processor again', async () => {
    const createRefund = vi.fn(async () => ({ refundId: 're_5' }));
    const { result } = run(
      { begin: { ...BEGIN, status: 'REFUNDING' } },
      { STRIPE: stripe(createRefund) }
    );
    await expect(result).resolves.toMatchObject({ status: 200 });
    expect(createRefund).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'yekora-return-5' })
    );
  });

  describe('what the processor refunded outside the store counts (T2.2)', () => {
    const withTotal = (refunded: number) =>
      ({
        fetchRefundedTotal: vi.fn(async () => refunded),
        createRefund: vi.fn(async () => ({ refundId: 're_out' })),
      }) as unknown as PaymentProcessorPort;

    it('refuses when the refund, with what was refunded in the dashboard, would pass the total', async () => {
      const processor = withTotal(160000);
      const { harness, result } = run({}, { STRIPE: processor });
      const answer = await result;
      expect(answer.status).toBe(409);
      expect(answer.body).toMatchObject({
        detail: 'INVALID_REFUND_AMOUNT_REJECT',
      });
      expect(processor.createRefund).not.toHaveBeenCalled();
      expect(
        harness.wrote("UPDATE order_returns SET status = 'REFUNDING'")
      ).toEqual([]);
    });

    it('accepts it when it fits exactly in what is left', async () => {
      const processor = withTotal(155000);
      const { result } = run({}, { STRIPE: processor });
      await expect(result).resolves.toMatchObject({ status: 200 });
      expect(processor.createRefund).toHaveBeenCalledOnce();
    });

    it('does not count it again on the retry of a request that stayed REFUNDING: its own refund is already there', async () => {
      const processor = withTotal(200000);
      const { result } = run(
        { begin: { ...BEGIN, status: 'REFUNDING' } },
        { STRIPE: processor }
      );
      await expect(result).resolves.toMatchObject({ status: 200 });
    });

    it('answers 502 and records nothing when Stripe cannot be asked how much is refunded', async () => {
      const processor = {
        fetchRefundedTotal: vi.fn(async () => {
          throw new PaymentProcessorError('Stripe: HTTP 500', 500);
        }),
        createRefund: vi.fn(),
      } as unknown as PaymentProcessorPort;
      const { harness, result } = run({}, { STRIPE: processor });
      const answer = await result;
      expect(answer.status).toBe(502);
      expect(answer.body).toMatchObject({ detail: 'REFUND_PROCESSOR_ERROR' });
      expect(harness.wrote('UPDATE')).toEqual([]);
    });
  });

  it('answers an already refunded request as it is, without asking the processor again', async () => {
    const createRefund = vi.fn();
    const { harness, result } = run(
      { begin: { ...BEGIN, status: 'REFUNDED' } },
      { STRIPE: stripe(createRefund) }
    );
    await expect(result).resolves.toMatchObject({ status: 200 });
    expect(createRefund).not.toHaveBeenCalled();
    expect(harness.wrote('UPDATE')).toEqual([]);
  });

  it('does not close a request that another confirmation already closed', async () => {
    const createRefund = vi.fn(async () => ({ refundId: 're_6' }));
    const { harness, result } = run(
      { fin: { status: 'REFUNDED', restock: 1 } },
      { STRIPE: stripe(createRefund) }
    );
    await expect(result).resolves.toMatchObject({ status: 200 });
    expect(
      harness.wrote("UPDATE order_returns SET status = 'REFUNDED'")
    ).toEqual([]);
    expect(harness.wrote('INSERT INTO outbox_events')).toEqual([]);
  });

  it.each([
    ['does not exist', { begin: null }, CONFIRMER, 404, 'RETURN_NOT_FOUND'],
    [
      'was never prepared',
      { begin: { ...BEGIN, status: 'REQUESTED', refund_mxn_cents: null } },
      CONFIRMER,
      409,
      'RETURN_NOT_PREPARED_REJECT',
    ],
    [
      'is confirmed by someone without the permission',
      {},
      { ...CONFIRMER, canConfirm: false },
      403,
      'UNAUTHORIZED_CONFIRMER_REJECT',
    ],
    [
      'is confirmed by the person who prepared it (four eyes)',
      {},
      { ...CONFIRMER, userId: 'user-1' },
      403,
      'DUAL_CONTROL_VIOLATION_REJECT',
    ],
    [
      'would refund more than the order paid',
      { committed: 160000 },
      CONFIRMER,
      409,
      'INVALID_REFUND_AMOUNT_REJECT',
    ],
  ])(
    'refuses a request that %s and calls nobody',
    async (_name, over, confirmer, status, code) => {
      const createRefund = vi.fn();
      const { harness, result } = run(
        over as Partial<Scenario>,
        { STRIPE: stripe(createRefund) },
        confirmer
      );
      const answer = await result;
      expect(answer.status).toBe(status);
      expect(answer.body).toMatchObject({ detail: code });
      expect(createRefund).not.toHaveBeenCalled();
      expect(
        harness.wrote("UPDATE order_returns SET status = 'REFUNDING'")
      ).toEqual([]);
    }
  );

  it.each([
    ['Stripe is not configured', {}],
    ['the adapter cannot refund', { STRIPE: stripe(undefined) }],
  ])(
    'answers 503 when %s, leaving the request REFUNDING',
    async (_name, processors) => {
      const { harness, result } = run({}, processors);
      const answer = await result;
      expect(answer.status).toBe(503);
      expect(answer.body).toMatchObject({
        detail: 'REFUND_PROCESSOR_UNAVAILABLE',
      });
      expect(
        harness.wrote("UPDATE order_returns SET status = 'REFUNDING'")
      ).toHaveLength(1);
      expect(
        harness.wrote("UPDATE order_returns SET status = 'REFUNDED'")
      ).toEqual([]);
    }
  );

  it('answers 503 when the order has no payment to refund', async () => {
    const { result } = run(
      { begin: { ...BEGIN, payment_resource_id: null } },
      { STRIPE: stripe(vi.fn()) }
    );
    expect((await result).status).toBe(503);
  });

  it('answers 502 when Stripe refuses, and the request stays REFUNDING to be retried', async () => {
    const createRefund = vi.fn(async () => {
      throw new PaymentProcessorError('Stripe: HTTP 402', 402);
    });
    const { harness, result } = run({}, { STRIPE: stripe(createRefund) });
    const answer = await result;
    expect(answer.status).toBe(502);
    expect(answer.body).toMatchObject({ detail: 'REFUND_PROCESSOR_ERROR' });
    expect(
      harness.wrote("UPDATE order_returns SET status = 'REFUNDED'")
    ).toEqual([]);
  });

  it('does not hide an error that is not the processor’s', async () => {
    const createRefund = vi.fn(async () => {
      throw new TypeError('boom');
    });
    const { result } = run({}, { STRIPE: stripe(createRefund) });
    await expect(result).rejects.toThrow('boom');
  });

  describe('Mercado Pago refunds are made by hand', () => {
    const MP = { ...BEGIN, processor_code: 'MERCADO_PAGO' };

    it('asks for the reference of the dispersion before recording any intent', async () => {
      const { harness, result } = run({ begin: MP }, {});
      const answer = await result;
      expect(answer.status).toBe(400);
      expect(answer.body).toMatchObject({
        detail: 'MANUAL_REFERENCE_REQUIRED',
      });
      expect(
        harness.wrote("UPDATE order_returns SET status = 'REFUNDING'")
      ).toEqual([]);
    });

    it('closes with the reference and no call to any processor', async () => {
      const createRefund = vi.fn();
      const { harness, result } = run(
        { begin: MP },
        { STRIPE: stripe(createRefund) },
        { ...CONFIRMER, manualReference: 'SPEI-778' }
      );
      await expect(result).resolves.toMatchObject({ status: 200 });
      expect(createRefund).not.toHaveBeenCalled();
      expect(
        harness.wrote("UPDATE order_returns SET status = 'REFUNDED'")[0].params
      ).toEqual([null, 'SPEI-778', 5]);
    });
  });
});

describe('readProcessorRefunded (T2.2: the cap counts the processor too)', () => {
  const read = (
    s: Scenario,
    fetchRefundedTotal?: PaymentProcessorPort['fetchRefundedTotal']
  ) =>
    readProcessorRefunded(
      {
        db: fakeDb(s).db,
        processors: {
          STRIPE: { fetchRefundedTotal } as unknown as PaymentProcessorPort,
        },
      },
      5
    );

  it('asks Stripe how much of the payment of the order is refunded', async () => {
    const fetchRefundedTotal = vi.fn(async () => 125000);
    await expect(read(scenario(), fetchRefundedTotal)).resolves.toBe(125000);
    expect(fetchRefundedTotal).toHaveBeenCalledWith('cs_test_1');
  });

  it.each([
    ['a request that does not exist', { target: null }],
    [
      'an order with no payment',
      { target: { processor_code: 'STRIPE', payment_resource_id: null } },
    ],
    [
      'an order paid at Mercado Pago, whose refunds are made by hand',
      {
        target: { processor_code: 'MERCADO_PAGO', payment_resource_id: 'p_1' },
      },
    ],
  ])('counts nothing for %s, and asks nobody', async (_name, over) => {
    const fetchRefundedTotal = vi.fn(async () => 1);
    await expect(
      read(scenario(over as Partial<Scenario>), fetchRefundedTotal)
    ).resolves.toBe(0);
    expect(fetchRefundedTotal).not.toHaveBeenCalled();
  });

  it('counts nothing when the adapter cannot say', async () => {
    await expect(read(scenario(), undefined)).resolves.toBe(0);
  });

  it('refuses when Stripe does not answer, since the cap could not be checked, and lets other errors through', async () => {
    await expect(
      read(
        scenario(),
        vi.fn(async () => {
          throw new PaymentProcessorError('Stripe: HTTP 500', 500);
        })
      )
    ).resolves.toBe('REFUND_PROCESSOR_ERROR');
    await expect(
      read(
        scenario(),
        vi.fn(async () => {
          throw new TypeError('boom');
        })
      )
    ).rejects.toThrow('boom');
  });
});

describe('isReturnRefund (link with the webhook of FC 069)', () => {
  const check = async (known: number, inFlight: number, ids: string[]) => {
    const { db, log } = fakeDb(scenario({ counts: { known, inFlight } }));
    return { linked: await isReturnRefund(db, 7, ids), log };
  };

  it('is false, without asking, for a charge that lists no refund', async () => {
    const { linked, log } = await check(0, 1, []);
    expect(linked).toBe(false);
    expect(log).toEqual([]);
  });

  it.each([
    ['every refund is recorded in a request', 2, 0, ['re_1', 're_2'], true],
    [
      'one is not recorded yet and one request is in flight',
      1,
      1,
      ['re_1', 're_2'],
      true,
    ],
    [
      'one is not recorded and no request is in flight',
      1,
      0,
      ['re_1', 're_2'],
      false,
    ],
    [
      'two are unknown and one request is in flight',
      0,
      1,
      ['re_1', 're_2'],
      false,
    ],
  ])('when %s: %s', async (_name, known, inFlight, ids, expected) => {
    expect((await check(known, inFlight, ids)).linked).toBe(expected);
  });

  it('searches the refund ids as one list', async () => {
    const { log } = await check(1, 0, ['re_1']);
    expect(log[0].params).toEqual([7, ['re_1']]);
  });
});
