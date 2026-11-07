/**
 * FC 028 F1 evidence: orders are read-only (T2.6a), a buyer reads only their own (T2.6b, T1.2 D),
 * the panel needs `orders:read` and staff's authenticator (T1.2 P, T2.1a), and every answered
 * panel request lands in the audit trail without personal data (T2.5a, T2.5b).
 *
 * The database is an in-memory table of handlers keyed by the start of each statement, so the
 * real guard, routes and repository run unchanged.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { tokenHash } from '../services/authCrypto';
import type { Db, Transactional } from '../services/db';
import { ORDER_PATHS, WRITE_METHODS } from './orders';

const KEY = Buffer.alloc(32, 7).toString('base64');
const NOW = new Date('2026-11-03T18:00:00Z');

/** A signed-in user of the fake database. */
interface FakeUser {
  id: string;
  roles: { role: string; permission: string }[];
  totp: number;
}

const BUYER: FakeUser = {
  id: 'b0000000-0000-4000-8000-000000000001',
  roles: [{ role: 'customer', permission: 'account:self' }],
  totp: 0,
};
const STAFF: FakeUser = {
  id: 'c0000000-0000-4000-8000-000000000002',
  roles: [{ role: 'staff_orders', permission: 'orders:read' }],
  totp: 1,
};
const STAFF_WITHOUT_TOTP: FakeUser = {
  ...STAFF,
  id: STAFF.id.replace('c', 'd'),
  totp: 0,
};

const TOKENS = new Map<string, FakeUser>([
  [tokenHash('b'.repeat(43)), BUYER],
  [tokenHash('s'.repeat(43)), STAFF],
  [tokenHash('n'.repeat(43)), STAFF_WITHOUT_TOTP],
]);
const cookie = (letter: string) => ({
  cookie: `__Host-yekora_session=${letter.repeat(43)}`,
});

const OWN = 'YEK-2026-OWN00001';
const OTHER = 'YEK-2026-OTHER001';
const GUEST = 'YEK-2026-GUEST001';

const order = (
  id: number,
  orderNumber: string,
  owner: string | null,
  status: string,
  paidAt: Date | null
) => ({
  id,
  user_id: owner,
  order_number: orderNumber,
  status,
  method: 'CARD',
  items_total_mxn_cents: '185000',
  shipping_total_mxn_cents: '15000',
  total_mxn_cents: '200000',
  created_at: new Date('2026-11-01T10:00:00Z'),
  expires_at: new Date('2026-11-01T11:00:00Z'),
  paid_at: paidAt,
  is_test: id === 1 ? 1 : 0,
});

const ORDERS = [
  order(1, OWN, BUYER.id, 'PAID', new Date('2026-11-01T10:20:00Z')),
  order(
    2,
    OTHER,
    'e0000000-0000-4000-8000-000000000005',
    'PENDING_PAYMENT',
    null
  ),
  order(3, GUEST, null, 'EXPIRED', null),
];

const EVENTS = [
  {
    order_id: 1,
    processor: 'STRIPE',
    event_type: 'checkout.session.completed',
    processor_status: 'paid',
    amount_mxn_cents: '200000',
    resulting_status: 'PAID',
    is_alert: 0,
    received_at: new Date('2026-11-01T10:20:00Z'),
  },
  {
    order_id: 3,
    processor: 'MERCADO_PAGO',
    event_type: 'payment',
    processor_status: null,
    amount_mxn_cents: null,
    resulting_status: null,
    is_alert: 1,
    received_at: new Date('2026-11-01T12:00:00Z'),
  },
];

/** What the fake database saw. */
const seen = {
  sql: [] as { text: string; params: readonly unknown[] }[],
  audit: [] as unknown[][],
  failAudit: false,
};

type Handler = (params: readonly unknown[]) => unknown[];

/** The orders a list or count statement selects: a buyer's, or the panel's by status. */
const listed = (text: string, params: readonly unknown[]) =>
  text.includes('(? IS NULL')
    ? ORDERS.filter((row) => params[0] === null || row.status === params[0])
    : ORDERS.filter((row) => row.user_id === params[0]);

/** One page of a list statement, whose last two parameters are LIMIT and OFFSET. */
const paged = (text: string, params: readonly unknown[]) => {
  const [limit, offset] = params.slice(-2) as number[];
  return listed(text, params).slice(offset, offset + limit);
};

const HANDLERS: [string, Handler][] = [
  [
    'SELECT s.id, s.user_id',
    (p) => {
      const user = TOKENS.get(p[0] as string);
      return user
        ? [
            {
              id: p[0],
              user_id: user.id,
              email: 'x@example.test',
              full_name: 'X',
            },
          ]
        : [];
    },
  ],
  [
    'SELECT ur.role_id',
    (p) =>
      [BUYER, STAFF, STAFF_WITHOUT_TOTP]
        .find((user) => user.id === p[0])
        ?.roles.map((r) => ({
          role_id: r.role,
          permission_id: r.permission,
        })) ?? [],
  ],
  [
    'SELECT is_totp_enabled',
    (p) => [
      {
        is_totp_enabled: [STAFF, STAFF_WITHOUT_TOTP].find((u) => u.id === p[0])
          ?.totp,
      },
    ],
  ],
  ['SELECT id FROM orders WHERE status_id = 1', () => []],
  [
    'SELECT o.id, o.user_id',
    (p) => ORDERS.filter((row) => row.order_number === p[0]),
  ],
  [
    'SELECT sku',
    (p) =>
      p[0] === 1
        ? [
            {
              sku: 'PACK',
              quantity: 1,
              unit_price_mxn_cents: '185000',
              line_total_mxn_cents: '185000',
            },
          ]
        : [],
  ],
  [
    'SELECT p.code AS processor',
    (p) => EVENTS.filter((e) => e.order_id === p[0]),
  ],
  [
    'INSERT INTO audit_log',
    (p) => {
      if (seen.failAudit) throw new Error('audit_log is down');
      seen.audit.push([...p]);
      return [];
    },
  ],
];

const db: Db & Transactional = {
  async query<Row>(text: string, params: readonly unknown[] = []) {
    seen.sql.push({ text, params });
    if (text.startsWith('SELECT o.order_number'))
      return paged(text, params) as Row[];
    if (text.startsWith('SELECT COUNT(*)'))
      return [{ n: listed(text, params).length }] as Row[];
    const handler = HANDLERS.find(([start]) => text.startsWith(start));
    return (handler ? handler[1](params) : []) as Row[];
  },
  ping: async () => undefined,
  transaction(work) {
    return work(this);
  },
  close: async () => undefined,
};

let app: FastifyInstance;

/** Lets the onResponse audit hook, which runs after the answer has left, finish. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

beforeAll(async () => {
  app = await buildApp({
    config: loadConfig({
      DB_HOST: '127.0.0.1',
      DB_USER: 'root',
      DB_NAME: 'yekora_dev',
      AUTH_SECRET: KEY,
      TOTP_ENCRYPTION_KEY: KEY,
    }),
    db,
    rate: async () => null,
    logger: false,
    now: () => NOW,
  });
  await app.ready();
}, 30_000);

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  seen.sql.length = 0;
  seen.audit.length = 0;
  seen.failAudit = false;
});

describe('T2.6a orders are read-only: every write is refused with 405', () => {
  const writes = ORDER_PATHS.flatMap((path) =>
    WRITE_METHODS.map(
      (method) => [method, path.replace(':order_number', OWN)] as const
    )
  );

  it.each(writes)(
    'OWASP-A01 · %s %s answers 405 and touches nothing',
    async (method, url) => {
      for (const headers of [{}, cookie('b'), cookie('s')]) {
        const response = await app.inject({ method, url, headers });
        expect(response.statusCode).toBe(405);
        expect(response.headers.allow).toBe('GET, HEAD');
        expect(response.json()).toMatchObject({ detail: 'ORDERS_READ_ONLY' });
      }
      expect(seen.sql).toEqual([]);
    }
  );
});

describe('T2.6b a buyer reads only their own orders (T1.2 D)', () => {
  it('OWASP-A01 · lists with the session user as the filter, newest first, 20 per page', async () => {
    const response = await app.inject({
      url: '/v1/account/orders',
      headers: cookie('b'),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        {
          orderNumber: OWN,
          status: 'PAID',
          method: 'CARD',
          itemsTotalMxnCents: 185_000,
          shippingTotalMxnCents: 15_000,
          totalMxnCents: 200_000,
          createdAt: '2026-11-01T10:00:00.000Z',
          expiresAt: '2026-11-01T11:00:00.000Z',
          paidAt: '2026-11-01T10:20:00.000Z',
          isTest: true,
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    const list = seen.sql.find(({ text }) =>
      text.startsWith('SELECT o.order_number')
    );
    expect(list?.text).toContain('WHERE o.user_id = ?');
    expect(list?.params).toEqual([BUYER.id, 20, 0]);
  });

  it('OWASP-A01 · refuses a malformed page with 400', async () => {
    const response = await app.inject({
      url: '/v1/account/orders?page=0',
      headers: cookie('b'),
    });
    expect(response.statusCode).toBe(400);
  });

  it('OWASP-A01 · shows the own order with its lines and payment events', async () => {
    const response = await app.inject({
      url: `/v1/account/orders/${OWN}`,
      headers: cookie('b'),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      orderNumber: OWN,
      lines: [
        {
          sku: 'PACK',
          quantity: 1,
          unitPriceMxnCents: 185_000,
          lineTotalMxnCents: 185_000,
        },
      ],
      paymentEvents: [
        {
          processor: 'STRIPE',
          eventType: 'checkout.session.completed',
          processorStatus: 'paid',
          amountMxnCents: 200_000,
          resultingStatus: 'PAID',
          isAlert: false,
          receivedAt: '2026-11-01T10:20:00.000Z',
        },
      ],
    });
  });

  it.each([OTHER, GUEST])(
    'OWASP-A01 · refuses %s, not the buyer’s, with 403 DATA_DOMAIN_FORBIDDEN',
    async (orderNumber) => {
      const response = await app.inject({
        url: `/v1/account/orders/${orderNumber}`,
        headers: cookie('b'),
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        detail: 'DATA_DOMAIN_FORBIDDEN',
      });
    }
  );

  it.each(['YEK-2026-NOPE0000', 'not-an-order'])(
    'OWASP-A01 · answers 404 to %s',
    async (orderNumber) => {
      const response = await app.inject({
        url: `/v1/account/orders/${orderNumber}`,
        headers: cookie('b'),
      });
      expect(response.statusCode).toBe(404);
    }
  );

  it('OWASP-A01 · answers 401 SESSION_INVALID_OR_EXPIRED without a session', async () => {
    const response = await app.inject({ url: '/v1/account/orders' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      detail: 'SESSION_INVALID_OR_EXPIRED',
    });
  });

  it('OWASP-A01 · leaves no audit entry: only the panel is audited', async () => {
    await app.inject({ url: '/v1/account/orders', headers: cookie('b') });
    await settle();
    expect(seen.audit).toEqual([]);
  });
});

describe('T1.2 the panel needs orders:read, and staff their authenticator (T2.1a)', () => {
  it('OWASP-A01 · refuses a buyer with 403 PERMISSION_DENIED', async () => {
    const response = await app.inject({
      url: '/v1/admin/orders',
      headers: cookie('b'),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ detail: 'PERMISSION_DENIED' });
  });

  it('OWASP-A01 · refuses staff without the authenticator with 403 SECOND_FACTOR_REQUIRED', async () => {
    const response = await app.inject({
      url: '/v1/admin/orders',
      headers: cookie('n'),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ detail: 'SECOND_FACTOR_REQUIRED' });
  });

  it('OWASP-A01 · lists every order for staff, or those of one status', async () => {
    const all = await app.inject({
      url: '/v1/admin/orders',
      headers: cookie('s'),
    });
    expect(all.json()).toMatchObject({ total: 3, page: 1, pageSize: 20 });
    const paid = await app.inject({
      url: '/v1/admin/orders?status=PAID&page=2&pageSize=5',
      headers: cookie('s'),
    });
    expect(paid.json()).toMatchObject({
      items: [],
      total: 1,
      page: 2,
      pageSize: 5,
    });
    const list = seen.sql.filter(({ text }) =>
      text.startsWith('SELECT o.order_number')
    );
    expect(list.map(({ params }) => params)).toEqual([
      [null, null, 20, 0],
      ['PAID', 'PAID', 5, 5],
    ]);
  });

  it('OWASP-A01 · shows any order to staff, a guest purchase included', async () => {
    const response = await app.inject({
      url: `/v1/admin/orders/${GUEST}`,
      headers: cookie('s'),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      orderNumber: GUEST,
      status: 'EXPIRED',
      paidAt: null,
      isTest: false,
      lines: [],
      paymentEvents: [
        {
          amountMxnCents: null,
          resultingStatus: null,
          isAlert: true,
          processorStatus: null,
        },
      ],
    });
  });

  it('OWASP-A01 · answers 404 to an unknown order and 400 to an unknown status', async () => {
    const unknown = await app.inject({
      url: '/v1/admin/orders/YEK-2026-NOPE0000',
      headers: cookie('s'),
    });
    expect(unknown.statusCode).toBe(404);
    const status = await app.inject({
      url: '/v1/admin/orders?status=LOST',
      headers: cookie('s'),
    });
    expect(status.statusCode).toBe(400);
  });
});

describe('T2.5 every answered panel request is audited, without personal data', () => {
  it('records who read what, from where, after the answer', async () => {
    await app.inject({
      url: `/v1/admin/orders/${OWN}`,
      headers: cookie('s'),
      remoteAddress: '203.0.113.9',
    });
    await settle();
    expect(seen.audit).toEqual([
      [
        STAFF.id,
        'GET /v1/admin/orders/:order_number',
        'orders',
        OWN,
        null,
        JSON.stringify({ query: {}, status: 200 }),
        '203.0.113.9',
      ],
    ]);
  });

  it('redacts e-mails, names and the like wherever they appear (T2.5b)', async () => {
    const response = await app.inject({
      url: '/v1/admin/orders?q=ana@example.com&name=Ana&tag=a&tag=b',
      headers: cookie('s'),
    });
    expect(response.statusCode).toBe(400);
    await settle();
    const after = JSON.parse(seen.audit[0][5] as string) as unknown;
    expect(after).toEqual({
      query: { q: '[redacted]', name: '[redacted]', tag: ['a', 'b'] },
      status: 400,
    });
    expect(seen.audit[0][3]).toBe('*');
  });

  it('keeps answering when the trail cannot be written', async () => {
    seen.failAudit = true;
    const response = await app.inject({
      url: '/v1/admin/orders',
      headers: cookie('s'),
    });
    expect(response.statusCode).toBe(200);
    await settle();
    expect(seen.audit).toEqual([]);
  });
});
