/**
 * FC 071 F1 evidence: the four routes of the returns behind the guard (401, 403
 * SECOND_FACTOR_REQUIRED, 403 PERMISSION_DENIED), the validation of what is sent, the refusals of
 * the services as problems, once per Idempotency-Key for the writes that take one, and four eyes at
 * the confirmation (T1.2, T2.1).
 *
 * The database is an in-memory table of handlers keyed by the start of each statement, so the real
 * guard, routes and services run unchanged.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { tokenHash } from '../services/authCrypto';
import type { Db, Transactional } from '../services/db';

const KEY = Buffer.alloc(32, 7);
const NOW = new Date('2026-11-23T18:00:00Z');
const NUMBER = 'YEK-2026-AB12CD34';

const OWNER = 'a0000000-0000-4000-8000-000000000001';
const NO_TOTP = 'a0000000-0000-4000-8000-000000000002';
const BUYER = 'a0000000-0000-4000-8000-000000000003';
const SELLER = 'a0000000-0000-4000-8000-000000000004';

/** Cookies: `w` owner, `n` admin without authenticator, `b` buyer, `s` seller (view and prepare). */
const TOKENS = new Map([
  [tokenHash('w'.repeat(43)), OWNER],
  [tokenHash('n'.repeat(43)), NO_TOTP],
  [tokenHash('b'.repeat(43)), BUYER],
  [tokenHash('s'.repeat(43)), SELLER],
]);
const session = (letter: string) =>
  `__Host-yekora_session=${letter.repeat(43)}`;

const ROLE_OF: Record<string, string> = {
  [OWNER]: 'owner',
  [NO_TOTP]: 'admin',
  [BUYER]: 'customer',
  [SELLER]: 'staff_orders',
};
const PERMISSIONS: Record<string, string[]> = {
  owner: ['account:self', 'returns:view', 'returns:prepare', 'returns:confirm'],
  admin: ['account:self', 'returns:view', 'returns:prepare', 'returns:confirm'],
  staff_orders: ['account:self', 'returns:view', 'returns:prepare'],
  customer: ['account:self'],
};

const store = {
  delivered: true,
  status: 'REQUESTED',
  preparedBy: null as string | null,
  processor: 'STRIPE',
  inserted: [] as unknown[][],
  audit: [] as unknown[][],
  keys: new Map<string, Record<string, unknown>>(),
};

const VIEW = () => ({
  id: 5,
  order_number: NUMBER,
  status: store.status,
  reason: 'DEFECT',
  comment: null,
  refund_mxn_cents: store.status === 'REQUESTED' ? null : 45000,
  restock: store.status === 'REQUESTED' ? null : 1,
  created_at: NOW,
  prepared_at: store.status === 'REQUESTED' ? null : NOW,
  confirmed_at: null,
});

type Handler = (params: readonly unknown[]) => unknown;

const HANDLERS: [string, Handler][] = [
  [
    'SELECT s.id, s.user_id',
    (p) => {
      const id = TOKENS.get(p[0] as string);
      return id
        ? [
            {
              id: p[0],
              user_id: id,
              email: `${id}@example.test`,
              full_name: 'X',
            },
          ]
        : [];
    },
  ],
  [
    'SELECT ur.role_id',
    (p) =>
      PERMISSIONS[ROLE_OF[p[0] as string]].map((permission) => ({
        role_id: ROLE_OF[p[0] as string],
        permission_id: permission,
      })),
  ],
  [
    'SELECT is_totp_enabled',
    (p) => [{ is_totp_enabled: p[0] === NO_TOTP ? 0 : 1 }],
  ],
  [
    'SELECT route, request_hash',
    (p) => {
      const row = store.keys.get(p[0] as string);
      return row ? [row] : [];
    },
  ],
  [
    'INSERT INTO idempotency_keys',
    (p) => {
      store.keys.set(p[0] as string, {
        route: p[2],
        request_hash: p[3],
        response_status: p[4],
        response_body: p[6],
        expires_at: p[7],
      });
      return [];
    },
  ],
  [
    'SELECT id, user_id, status_id, delivered_at FROM orders',
    (p) =>
      p[0] === NUMBER
        ? [
            {
              id: 7,
              user_id: BUYER,
              status_id: store.delivered ? 9 : 8,
              delivered_at: store.delivered
                ? new Date('2026-11-10T12:00:00Z')
                : null,
            },
          ]
        : [],
  ],
  [
    'SELECT i.id, i.sku',
    () => [{ id: 11, sku: 'TENT', quantity: 2, allows_return: 1, returned: 0 }],
  ],
  ['INSERT INTO order_returns', () => ({ insertId: 5 })],
  [
    'INSERT INTO order_return_items',
    (p) => {
      store.inserted.push(p[0] as unknown[]);
      return { affectedRows: 1 };
    },
  ],
  ['SELECT ri.return_id', () => [{ return_id: 5, sku: 'TENT', quantity: 1 }]],
  ['SELECT r.id, o.order_number, r.status', () => [VIEW()]],
  [
    'SELECT COUNT(*) AS n FROM order_returns WHERE (? IS NULL',
    () => [{ n: 1 }],
  ],
  ['SELECT COALESCE(SUM', () => [{ n: 0 }]],
  [
    'SELECT r.order_id, r.status',
    () => [{ order_id: 7, status: store.status, total_mxn_cents: 200000 }],
  ],
  [
    "UPDATE order_returns SET status = 'PREPARED'",
    () => {
      store.status = 'PREPARED';
      return { affectedRows: 1 };
    },
  ],
  [
    'SELECT r.order_id, o.order_number',
    () => [
      {
        order_id: 7,
        order_number: NUMBER,
        status: store.status,
        prepared_by: store.preparedBy,
        refund_mxn_cents: 45000,
        total_mxn_cents: 200000,
        payment_resource_id: 'cs_test_1',
        processor_code: store.processor,
      },
    ],
  ],
  [
    'SELECT status, restock FROM order_returns',
    () => [{ status: 'REFUNDING', restock: 1 }],
  ],
  [
    'SELECT status_id, total_mxn_cents FROM orders',
    () => [{ status_id: 9, total_mxn_cents: 200000 }],
  ],
  [
    'INSERT INTO audit_log',
    (p) => {
      store.audit.push([...p]);
      return [];
    },
  ],
];

const db: Db & Transactional = {
  async query<Row>(text: string, params: readonly unknown[] = []) {
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

beforeAll(async () => {
  app = await buildApp({
    config: loadConfig({
      DB_HOST: '127.0.0.1',
      DB_USER: 'root',
      DB_NAME: 'yekora_dev',
      AUTH_SECRET: KEY.toString('base64'),
      TOTP_ENCRYPTION_KEY: KEY.toString('base64'),
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
  store.delivered = true;
  store.status = 'REQUESTED';
  store.preparedBy = null;
  store.processor = 'STRIPE';
  store.inserted = [];
  store.audit = [];
  store.keys.clear();
});

interface Options {
  who?: string | null;
  key?: string | null;
  payload?: unknown;
}

const send = (
  method: 'GET' | 'POST',
  url: string,
  { who = 'w', key = null, payload }: Options = {}
) =>
  app.inject({
    method,
    url,
    headers: {
      ...(who === null ? {} : { cookie: session(who) }),
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      ...(key === null ? {} : { 'idempotency-key': key }),
    },
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
  });

const REQUEST = {
  items: [{ sku: 'TENT', quantity: 2 }],
  reason: 'DEFECT',
  comment: 'No cierra',
};
const ASK = `/v1/account/orders/${NUMBER}/returns`;

describe('POST /v1/account/orders/:order_number/returns', () => {
  it('creates the request of the buyer: 201, its lines and an audit entry', async () => {
    const answer = await send('POST', ASK, {
      who: 'b',
      key: 'k-1',
      payload: REQUEST,
    });
    expect(answer.statusCode).toBe(201);
    expect(answer.json()).toMatchObject({
      id: 5,
      orderNumber: NUMBER,
      status: 'REQUESTED',
      items: [{ sku: 'TENT', quantity: 1 }],
    });
    expect(store.inserted).toEqual([[[5, 11, 2]]]);
    expect(store.audit.flat()).toContain('RETURN_REQUESTED');
  });

  it('runs once per Idempotency-Key: the second answer is the first, nothing is inserted twice', async () => {
    await send('POST', ASK, { who: 'b', key: 'k-2', payload: REQUEST });
    const again = await send('POST', ASK, {
      who: 'b',
      key: 'k-2',
      payload: REQUEST,
    });
    expect(again.statusCode).toBe(201);
    expect(again.headers['idempotency-status']).toBe('IDEMP_REPLAY_SUCCESS');
    expect(store.inserted).toHaveLength(1);
  });

  it('is a 401 without a session', async () => {
    const answer = await send('POST', ASK, {
      who: null,
      key: 'k-3',
      payload: REQUEST,
    });
    expect(answer.statusCode).toBe(401);
  });

  it('is a 400 without an Idempotency-Key, with a malformed order number or with a payload that is not a request', async () => {
    expect(
      (await send('POST', ASK, { who: 'b', payload: REQUEST })).json().detail
    ).toBe('IDEMP_KEY_MISSING');
    const badNumber = await send('POST', '/v1/account/orders/nope/returns', {
      who: 'b',
      key: 'k-4',
      payload: REQUEST,
    });
    expect(badNumber.statusCode).toBe(400);
    expect(badNumber.json().detail).toBe('RETURN_PAYLOAD_INVALID');
    const badBody = await send('POST', ASK, {
      who: 'b',
      key: 'k-5',
      payload: { items: [], reason: 'DEFECT' },
    });
    expect(badBody.statusCode).toBe(400);
    expect(badBody.json().detail).toBe('RETURN_PAYLOAD_INVALID');
  });

  it('turns a refusal of T1.1 into its problem: an order not delivered is a 409, another buyer’s order a 403, an unknown one a 404', async () => {
    store.delivered = false;
    const early = await send('POST', ASK, {
      who: 'b',
      key: 'k-6',
      payload: REQUEST,
    });
    expect(early.statusCode).toBe(409);
    expect(early.json().detail).toBe('ORDER_NOT_DELIVERED_REJECT');
    store.delivered = true;
    const foreign = await send('POST', ASK, {
      who: 'w',
      key: 'k-7',
      payload: REQUEST,
    });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json().detail).toBe('DATA_DOMAIN_FORBIDDEN');
    const unknown = await send(
      'POST',
      '/v1/account/orders/YEK-2026-ZZ99ZZ99/returns',
      { who: 'b', key: 'k-8', payload: REQUEST }
    );
    expect(unknown.statusCode).toBe(404);
    expect(store.inserted).toEqual([]);
  });
});

describe('GET /v1/admin/returns', () => {
  it('lists the board for returns:view, filtered by stage', async () => {
    const answer = await send('GET', '/v1/admin/returns?status=REQUESTED', {
      who: 's',
    });
    expect(answer.statusCode).toBe(200);
    expect(answer.json()).toMatchObject({
      total: 1,
      items: [{ id: 5, orderNumber: NUMBER, status: 'REQUESTED' }],
    });
  });

  it('lists every stage without a filter and refuses one that does not exist', async () => {
    expect((await send('GET', '/v1/admin/returns')).statusCode).toBe(200);
    const bad = await send('GET', '/v1/admin/returns?status=NOPE');
    expect(bad.statusCode).toBe(400);
    expect(bad.json().detail).toBe('RETURN_PAYLOAD_INVALID');
  });

  it('is closed to a buyer, a session without authenticator and no session', async () => {
    expect(
      (await send('GET', '/v1/admin/returns', { who: 'b' })).json().detail
    ).toBe('PERMISSION_DENIED');
    expect(
      (await send('GET', '/v1/admin/returns', { who: 'n' })).json().detail
    ).toBe('SECOND_FACTOR_REQUIRED');
    expect(
      (await send('GET', '/v1/admin/returns', { who: null })).statusCode
    ).toBe(401);
  });
});

describe('POST /v1/admin/returns/:id/prepare', () => {
  const PREPARE = { refundMxnCents: 45000, restock: true };

  it('prepares the refund as a seller with returns:prepare', async () => {
    const answer = await send('POST', '/v1/admin/returns/5/prepare', {
      who: 's',
      key: 'p-1',
      payload: PREPARE,
    });
    expect(answer.statusCode).toBe(200);
    expect(answer.json()).toMatchObject({
      status: 'PREPARED',
      refundMxnCents: 45000,
      restock: true,
    });
    expect(store.audit.flat()).toContain('RETURN_PREPARED');
  });

  it('refuses a request already prepared with 409 and a buyer with 403', async () => {
    store.status = 'PREPARED';
    const again = await send('POST', '/v1/admin/returns/5/prepare', {
      who: 's',
      key: 'p-2',
      payload: PREPARE,
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().detail).toBe('RETURN_STATUS_CONFLICT');
    const buyer = await send('POST', '/v1/admin/returns/5/prepare', {
      who: 'b',
      key: 'p-3',
      payload: PREPARE,
    });
    expect(buyer.statusCode).toBe(403);
  });

  it('is a 400 without a key, with a bad id or with a bad body', async () => {
    expect(
      (
        await send('POST', '/v1/admin/returns/5/prepare', {
          payload: PREPARE,
        })
      ).json().detail
    ).toBe('IDEMP_KEY_MISSING');
    expect(
      (
        await send('POST', '/v1/admin/returns/abc/prepare', {
          key: 'p-4',
          payload: PREPARE,
        })
      ).json().detail
    ).toBe('RETURN_PAYLOAD_INVALID');
    expect(
      (
        await send('POST', '/v1/admin/returns/5/prepare', {
          key: 'p-5',
          payload: { refundMxnCents: -1, restock: 'yes' },
        })
      ).statusCode
    ).toBe(400);
  });
});

describe('POST /v1/admin/returns/:id/confirm', () => {
  it('refuses the person who prepared the refund: four eyes by user id (T2.1)', async () => {
    store.status = 'PREPARED';
    store.preparedBy = OWNER;
    const answer = await send('POST', '/v1/admin/returns/5/confirm', {
      who: 'w',
    });
    expect(answer.statusCode).toBe(403);
    expect(answer.json().detail).toBe('DUAL_CONTROL_VIOLATION_REJECT');
  });

  it('is closed to a seller without returns:confirm, who never reaches the service', async () => {
    store.status = 'PREPARED';
    const answer = await send('POST', '/v1/admin/returns/5/confirm', {
      who: 's',
    });
    expect(answer.statusCode).toBe(403);
    expect(answer.json().detail).toBe('PERMISSION_DENIED');
  });

  it('answers 503 when the processor of the order is not configured, leaving the request to be retried', async () => {
    store.status = 'PREPARED';
    store.preparedBy = SELLER;
    const answer = await send('POST', '/v1/admin/returns/5/confirm', {
      who: 'w',
      payload: {},
    });
    expect(answer.statusCode).toBe(503);
    expect(answer.json().detail).toBe('REFUND_PROCESSOR_UNAVAILABLE');
  });

  it('executes a refund made by hand at Mercado Pago when the reference comes with it: 200 and the request closed', async () => {
    store.status = 'PREPARED';
    store.preparedBy = SELLER;
    store.processor = 'MERCADO_PAGO';
    const answer = await send('POST', '/v1/admin/returns/5/confirm', {
      who: 'w',
      payload: { manualReference: 'SPEI-778' },
    });
    expect(answer.statusCode).toBe(200);
    expect(store.audit.flat()).toContain('RETURN_REFUNDED');
  });

  it('asks for that reference first: 400 MANUAL_REFERENCE_REQUIRED', async () => {
    store.status = 'PREPARED';
    store.preparedBy = SELLER;
    store.processor = 'MERCADO_PAGO';
    const answer = await send('POST', '/v1/admin/returns/5/confirm', {
      who: 'w',
    });
    expect(answer.statusCode).toBe(400);
    expect(answer.json().detail).toBe('MANUAL_REFERENCE_REQUIRED');
  });

  it('is a 400 for a bad id or a reference that is not text', async () => {
    expect(
      (await send('POST', '/v1/admin/returns/0/confirm')).json().detail
    ).toBe('RETURN_PAYLOAD_INVALID');
    expect(
      (
        await send('POST', '/v1/admin/returns/5/confirm', {
          payload: { manualReference: 7 },
        })
      ).statusCode
    ).toBe(400);
  });
});
