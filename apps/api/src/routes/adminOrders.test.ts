/**
 * FC 068 F1 evidence: the three fulfillment routes answer only to `orders:manage` behind the
 * three levels of the guard (T1.1 S), validate the shipment (T1.1 P), refuse an order in another
 * status with 409 (T1.1 C), run once per Idempotency-Key and leave an audit entry (T2.2), and the
 * order itself stays read-only (405 for PUT, PATCH and DELETE).
 *
 * The database is an in-memory table of handlers keyed by the start of each statement, so the
 * real guard, routes and machine run unchanged.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { tokenHash } from '../services/authCrypto';
import type { Db, Transactional } from '../services/db';

const KEY = Buffer.alloc(32, 7);
const NOW = new Date('2026-11-22T18:00:00Z');
const NUMBER = 'YEK-2026-AB12CD34';

const OWNER = 'a0000000-0000-4000-8000-000000000001';
const NO_TOTP = 'a0000000-0000-4000-8000-000000000002';
const READER = 'a0000000-0000-4000-8000-000000000003';
const STAFF = 'a0000000-0000-4000-8000-000000000004';

/** Cookies: `w` owner, `n` admin without authenticator, `r` reader (orders:read only), `s` staff. */
const TOKENS = new Map([
  [tokenHash('w'.repeat(43)), OWNER],
  [tokenHash('n'.repeat(43)), NO_TOTP],
  [tokenHash('r'.repeat(43)), READER],
  [tokenHash('s'.repeat(43)), STAFF],
]);
const session = (letter: string) =>
  `__Host-yekora_session=${letter.repeat(43)}`;

const ROLE_OF: Record<string, string> = {
  [OWNER]: 'owner',
  [NO_TOTP]: 'admin',
  [READER]: 'reader',
  [STAFF]: 'staff_orders',
};
const PERMISSIONS: Record<string, string[]> = {
  owner: ['account:self', 'orders:read', 'orders:manage'],
  admin: ['account:self', 'orders:read', 'orders:manage'],
  staff_orders: ['account:self', 'orders:read', 'orders:manage'],
  reader: ['account:self', 'orders:read'],
};

const CODES: Record<number, string> = {
  2: 'PAID',
  7: 'PREPARING',
  8: 'SHIPPED',
  9: 'DELIVERED',
};

interface Row {
  id: number;
  status_id: number;
  carrier: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  shipped_at: Date | null;
  delivered_at: Date | null;
}

const store = {
  order: null as Row | null,
  outbox: [] as { type: string; payload: Record<string, unknown> }[],
  audit: [] as unknown[][],
  keys: new Map<string, Record<string, unknown>>(),
};

type Handler = (params: readonly unknown[]) => unknown[];

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
    'SELECT id, status_id FROM orders',
    (p) =>
      store.order && p[0] === NUMBER
        ? [{ id: store.order.id, status_id: store.order.status_id }]
        : [],
  ],
  [
    'UPDATE orders SET status_id = ?, carrier = ?',
    (p) => {
      Object.assign(store.order as Row, {
        status_id: p[0],
        carrier: p[1],
        tracking_number: p[2],
        tracking_url: p[3],
        shipped_at: p[4],
      });
      return [];
    },
  ],
  [
    'UPDATE orders SET status_id = ?, delivered_at = ?',
    (p) => {
      Object.assign(store.order as Row, {
        status_id: p[0],
        delivered_at: p[1],
      });
      return [];
    },
  ],
  [
    'UPDATE orders SET status_id = ? WHERE id = ?',
    (p) => {
      (store.order as Row).status_id = p[0] as number;
      return [];
    },
  ],
  [
    'INSERT INTO outbox_events',
    (p) => {
      store.outbox.push({
        type: p[0] as string,
        payload: JSON.parse(p[1] as string),
      });
      return [];
    },
  ],
  [
    'SELECT s.code AS status',
    () => {
      const row = store.order as Row;
      return [{ ...row, status: CODES[row.status_id] }];
    },
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
  store.order = {
    id: 7,
    status_id: 2,
    carrier: null,
    tracking_number: null,
    tracking_url: null,
    shipped_at: null,
    delivered_at: null,
  };
  store.outbox = [];
  store.audit = [];
  store.keys.clear();
});

const SHIPMENT = {
  carrier: 'DHL',
  trackingNumber: '1234567890',
  trackingUrl: 'https://www.dhl.com/track?id=1234567890',
};

/** A step as the owner (or another session), with a key unless told otherwise. */
const post = (
  step: 'prepare' | 'ship' | 'deliver',
  options: {
    who?: string | null;
    key?: string | null;
    payload?: unknown;
    number?: string;
  } = {}
) =>
  app.inject({
    method: 'POST',
    url: `/v1/admin/orders/${options.number ?? NUMBER}/${step}`,
    headers: {
      ...(options.who === null ? {} : { cookie: session(options.who ?? 'w') }),
      ...(options.payload === undefined
        ? {}
        : { 'content-type': 'application/json' }),
      ...(options.key === null
        ? {}
        : { 'idempotency-key': options.key ?? 'k-1' }),
    },
    ...(options.payload === undefined
      ? {}
      : { payload: JSON.stringify(options.payload) }),
  });

describe('the guard of the fulfillment routes (FC 068 T1.1 S)', () => {
  it.each(['prepare', 'ship', 'deliver'] as const)(
    '%s: no session is a 401, no authenticator a 403 SECOND_FACTOR_REQUIRED, a reader a 403 PERMISSION_DENIED',
    async (step) => {
      const none = await post(step, { who: null, payload: SHIPMENT });
      expect(none.statusCode).toBe(401);
      expect(none.json().detail).toBe('SESSION_INVALID_OR_EXPIRED');
      const noSecondFactor = await post(step, { who: 'n', payload: SHIPMENT });
      expect(noSecondFactor.statusCode).toBe(403);
      expect(noSecondFactor.json().detail).toBe('SECOND_FACTOR_REQUIRED');
      const reader = await post(step, { who: 'r', payload: SHIPMENT });
      expect(reader.statusCode).toBe(403);
      expect(reader.json().detail).toBe('PERMISSION_DENIED');
      expect(store.order?.status_id).toBe(2);
      expect(store.outbox).toEqual([]);
    }
  );

  it('a staff member with orders:manage can operate, and so can the owner', async () => {
    expect((await post('prepare', { who: 's' })).statusCode).toBe(200);
    expect(
      (await post('ship', { who: 'w', payload: SHIPMENT, key: 'k-2' }))
        .statusCode
    ).toBe(200);
  });
});

describe('the steps through the routes (FC 068 T1.1 C, T2.1, T2.2)', () => {
  it('walks PAID → PREPARING → SHIPPED → DELIVERED, queuing a notice for the first two', async () => {
    const prepared = await post('prepare');
    expect(prepared.statusCode).toBe(200);
    expect(prepared.json().fulfillment).toBe('PREPARING');
    const shipped = await post('ship', { payload: SHIPMENT, key: 'k-2' });
    expect(shipped.statusCode).toBe(200);
    expect(shipped.json()).toMatchObject({
      fulfillment: 'SHIPPED',
      carrier: 'DHL',
      trackingNumber: '1234567890',
      shippedAt: NOW.toISOString(),
    });
    const delivered = await post('deliver', { key: 'k-3' });
    expect(delivered.statusCode).toBe(200);
    expect(delivered.json().fulfillment).toBe('DELIVERED');
    expect(store.outbox.map((event) => event.type)).toEqual([
      'ORDER_PREPARED',
      'ORDER_SHIPPED',
    ]);
    expect(store.audit.map((entry) => entry[1])).toEqual(
      expect.arrayContaining([
        'ORDER_PREPARED',
        'ORDER_SHIPPED',
        'ORDER_DELIVERED',
      ])
    );
  });

  it('runs once per key: a replay answers the same and queues one notice', async () => {
    const first = await post('prepare');
    const replay = await post('prepare');
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotency-status']).toBe('IDEMP_REPLAY_SUCCESS');
    expect(replay.body).toBe(first.body);
    expect(store.outbox).toHaveLength(1);
  });

  it('refuses a reused key for another request with 409', async () => {
    await post('ship', { payload: SHIPMENT });
    const other = await post('ship', {
      payload: { ...SHIPMENT, carrier: 'Estafeta' },
    });
    expect(other.statusCode).toBe(409);
    expect(other.json().detail).toBe('IDEMP_PAYLOAD_MISMATCH');
  });

  it('answers 409 ORDER_STATUS_CONFLICT for a step the order is not ready for, and 404 for an unknown order', async () => {
    const early = await post('deliver');
    expect(early.statusCode).toBe(409);
    expect(early.json().detail).toBe('ORDER_STATUS_CONFLICT');
    store.order = null;
    const missing = await post('prepare', { key: 'k-2' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().detail).toBe('ORDER_NOT_FOUND');
  });
});

describe('the shipment and the request (FC 068 T1.1 P)', () => {
  it('refuses a missing Idempotency-Key and a malformed order number with 400', async () => {
    expect((await post('prepare', { key: null })).statusCode).toBe(400);
    const bad = await post('prepare', { number: 'YEK-NOPE' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().detail).toBe('ORDER_PAYLOAD_INVALID');
  });

  it.each([
    ['no carrier', { trackingNumber: '1' }],
    ['an empty carrier', { carrier: '  ', trackingNumber: '1' }],
    ['no tracking number', { carrier: 'DHL' }],
    [
      'a carrier over 64 characters',
      { carrier: 'x'.repeat(65), trackingNumber: '1' },
    ],
    [
      'a tracking number over 128 characters',
      { carrier: 'DHL', trackingNumber: 'x'.repeat(129) },
    ],
    [
      'a link that is not a URL',
      { carrier: 'DHL', trackingNumber: '1', trackingUrl: 'no' },
    ],
    [
      'a link that is a script',
      {
        carrier: 'DHL',
        trackingNumber: '1',
        trackingUrl: 'javascript:alert(1)',
      },
    ],
    [
      'a link over 512 characters',
      {
        carrier: 'DHL',
        trackingNumber: '1',
        trackingUrl: `https://x.test/${'a'.repeat(512)}`,
      },
    ],
    ['an unknown field', { carrier: 'DHL', trackingNumber: '1', extra: true }],
  ])(
    'ship with %s is a 400 ORDER_PAYLOAD_INVALID and changes nothing',
    async (_case, payload) => {
      const response = await post('ship', { payload });
      expect(response.statusCode).toBe(400);
      expect(response.json().detail).toBe('ORDER_PAYLOAD_INVALID');
      expect(store.order?.status_id).toBe(2);
      expect(store.outbox).toEqual([]);
    }
  );

  it('ship without a body is a 400 too, and the other two steps need none', async () => {
    expect((await post('ship')).statusCode).toBe(400);
    expect((await post('prepare', { key: 'k-2' })).statusCode).toBe(200);
  });

  it('the order itself stays read-only: PUT, PATCH and DELETE answer 405 ORDERS_READ_ONLY', async () => {
    for (const method of ['PUT', 'PATCH', 'DELETE'] as const) {
      const response = await app.inject({
        method,
        url: `/v1/admin/orders/${NUMBER}`,
      });
      expect(response.statusCode).toBe(405);
      expect(response.json().detail).toBe('ORDERS_READ_ONLY');
    }
  });
});
