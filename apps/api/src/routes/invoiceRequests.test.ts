/**
 * FC 077 F2 evidence: asking for an invoice from the account and from the staff, the eight rows of
 * T1.1 with the three ways of being inside the window, the e-mail, legal name and postal code kept
 * only as ciphertext (T2.4), once per Idempotency-Key, and the queue of the staff.
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
const NOW = new Date('2026-11-27T18:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const NUMBER = 'YEK-2026-AB12CD34';

const BUYER = 'a0000000-0000-4000-8000-000000000003';
const SELLER = 'a0000000-0000-4000-8000-000000000004';
const TOKENS = new Map([
  [tokenHash('b'.repeat(43)), BUYER],
  [tokenHash('s'.repeat(43)), SELLER],
]);
const session = (letter: string) =>
  `__Host-yekora_session=${letter.repeat(43)}`;
const PERMISSIONS: Record<string, string[]> = {
  [BUYER]: ['account:self'],
  [SELLER]: ['account:self', 'invoices:read', 'invoices:request'],
};

const store = {
  order: null as Record<string, unknown> | null,
  returned: 0,
  history: {} as Record<string, unknown>,
  inserted: [] as unknown[],
  state: [] as Record<string, unknown>[],
  queueParams: [] as unknown[],
  audit: [] as unknown[],
  keys: new Map<string, Record<string, unknown>>(),
};

const HANDLERS: [string, (params: readonly unknown[]) => unknown][] = [
  [
    'SELECT s.id, s.user_id',
    (p) => {
      const id = TOKENS.get(p[0] as string);
      return id ? [{ id: p[0], user_id: id, email: 'x@example.test' }] : [];
    },
  ],
  [
    'SELECT ur.role_id',
    (p) =>
      PERMISSIONS[p[0] as string].map((permission) => ({
        role_id: p[0] === BUYER ? 'customer' : 'staff_orders',
        permission_id: permission,
      })),
  ],
  ['SELECT is_totp_enabled', () => [{ is_totp_enabled: 1 }]],
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
    'SELECT id, user_id, status_id, total_mxn_cents, paid_at FROM orders',
    () => (store.order ? [store.order] : []),
  ],
  ['SELECT COALESCE(SUM(refund_mxn_cents)', () => [{ n: store.returned }]],
  ['SELECT COALESCE(SUM(status IN', () => [store.history]],
  [
    'INSERT INTO invoice_requests',
    (p) => {
      store.inserted = [...p];
      return { insertId: 12 };
    },
  ],
  ['SELECT r.status, r.rejection_reason', () => store.state],
  [
    'SELECT r.id, o.order_number, o.channel',
    (p) => {
      store.queueParams = [...p];
      return [
        {
          id: 12,
          order_number: NUMBER,
          channel: 'online',
          total_mxn_cents: 200000,
          returned: '45000',
          status: 'PENDING',
          rfc: store.inserted[2],
          legal_name_enc: store.inserted[3],
          tax_system: '612',
          postal_code_enc: store.inserted[5],
          cfdi_use: 'G03',
          email_for_invoice_enc: store.inserted[7],
          rejection_reason: null,
          cancellation_reason: null,
          requested_at: NOW,
        },
      ];
    },
  ],
  ['SELECT COUNT(*) AS n FROM invoice_requests', () => [{ n: 1 }]],
  [
    'INSERT INTO audit_log',
    (p) => {
      store.audit.push(...p);
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

const BASE = {
  DB_HOST: '127.0.0.1',
  DB_USER: 'root',
  DB_NAME: 'yekora_dev',
  AUTH_SECRET: KEY.toString('base64'),
  TOTP_ENCRYPTION_KEY: KEY.toString('base64'),
};
const boot = async (extra: Record<string, string> = {}) => {
  const built = await buildApp({
    config: loadConfig({ ...BASE, ...extra }),
    db,
    rate: async () => null,
    logger: false,
    now: () => NOW,
  });
  await built.ready();
  return built;
};

let app: FastifyInstance;
let keyless: FastifyInstance;

beforeAll(async () => {
  app = await boot({
    CHECKOUT_PII_KEY: KEY.toString('base64'),
    CUSTOMER_EMAIL_HMAC_PEPPER: 'e'.repeat(32),
    ORDER_TOKEN_PEPPER: 't'.repeat(32),
  });
  keyless = await boot();
}, 30_000);

afterAll(async () => {
  await app.close();
  await keyless.close();
});

const ownOrder = () => ({
  id: 7,
  user_id: BUYER as string | null,
  status_id: 2,
  total_mxn_cents: 200000,
  paid_at: ago(1) as Date | null,
});
const noHistory = () => ({
  active: '0',
  rejected_at: null,
  cancelled_at: null,
});

beforeEach(() => {
  store.order = ownOrder();
  store.returned = 0;
  store.history = noHistory();
  store.inserted = [];
  store.state = [];
  store.queueParams = [];
  store.audit = [];
  store.keys.clear();
});

const DATA = {
  rfc: 'XAXX010101000',
  legalName: 'LA ROSA',
  taxSystem: '612',
  postalCode: '98612',
  cfdiUse: 'G03',
  emailForInvoice: 'ana@example.test',
};
const OWN = `/v1/account/orders/${NUMBER}/invoice-request`;
const STAFF = '/v1/admin/invoices/requests';

interface Options {
  who?: string;
  key?: string | null;
  payload?: unknown;
  target?: FastifyInstance;
}

const send = (
  method: 'GET' | 'POST',
  url: string,
  { who = 'b', key = 'k-1', payload, target }: Options = {}
) =>
  (target ?? app).inject({
    method,
    url,
    headers: {
      cookie: session(who),
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      ...(key === null ? {} : { 'idempotency-key': key }),
    },
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
  });

const ask = (options: Options = {}) =>
  send('POST', OWN, { payload: DATA, ...options });
const askForSomeone = (options: Options = {}) =>
  send('POST', STAFF, {
    who: 's',
    payload: { ...DATA, orderNumber: NUMBER },
    ...options,
  });

describe('asking for an invoice from the account (FC 077 F2)', () => {
  it('files it once per key, sealed, with nothing personal in the answer or the trail', async () => {
    const first = await ask();
    expect(first.statusCode).toBe(201);
    expect(first.json()).toEqual({ id: 12, status: 'PENDING' });
    expect((await ask()).headers['idempotency-status']).toBe(
      'IDEMP_REPLAY_SUCCESS'
    );
    const kept = JSON.stringify([
      store.inserted.map(String),
      [...store.keys.values()],
      store.audit,
    ]);
    for (const secret of [DATA.legalName, DATA.emailForInvoice]) {
      expect(kept).not.toContain(secret);
    }
    expect(store.inserted[8]).toMatch(/^[0-9a-f]{64}$/);
    expect(store.audit).toContain('INVOICE_REQUESTED');
  });

  it.each(
    Array.from({ length: 8 }, (_, row) => [
      (row & 4) === 0,
      (row & 2) === 0,
      (row & 1) === 0,
    ])
  )('T1.1 P=%s T=%s E=%s', async (paid, inTime, free) => {
    store.order = {
      ...ownOrder(),
      status_id: paid ? 9 : 5,
      paid_at: ago(inTime ? 30 : 31),
    };
    store.history = { ...noHistory(), active: free ? 0 : 1 };
    const answer = await ask();
    let code: string | undefined;
    if (!paid) code = 'ORDER_NOT_ELIGIBLE_REJECT';
    else if (!inTime) code = 'FISCAL_DEADLINE_EXPIRED_REJECT';
    else if (!free) code = 'INVOICE_ALREADY_EXISTS_REJECT';
    expect(answer.json().detail).toBe(code);
    expect(answer.statusCode === 201).toBe(code === undefined);
  });

  it.each([
    ['refused 7 days ago', { rejected_at: ago(7) }, 201],
    ['cancelled 7 days ago', { cancelled_at: ago(7) }, 201],
    [
      'refused 8 days ago and cancelled 8 days ago',
      { rejected_at: ago(8), cancelled_at: ago(8) },
      400,
    ],
  ])('after the 30 days, a request %s answers %s', async (_c, when, status) => {
    store.order = { ...ownOrder(), paid_at: ago(60) };
    store.history = { ...noHistory(), ...when };
    expect((await ask()).statusCode).toBe(status);
  });

  it('has no window for an order with no date of payment', async () => {
    store.order = { ...ownOrder(), paid_at: null };
    expect((await ask()).json().detail).toBe('FISCAL_DEADLINE_EXPIRED_REJECT');
  });

  it('refuses an order whose returns pay back all it charged', async () => {
    store.returned = 200000;
    expect((await ask()).json().detail).toBe('ORDER_NOT_ELIGIBLE_REJECT');
  });

  it('reads someone else’s order, or a wrong number, as not found', async () => {
    store.order = { ...ownOrder(), user_id: SELLER };
    expect((await ask()).statusCode).toBe(404);
    store.order = null;
    expect((await ask({ key: 'k-2' })).statusCode).toBe(404);
    const wrong = await send('POST', '/v1/account/orders/x/invoice-request', {
      payload: DATA,
    });
    expect(wrong.statusCode).toBe(404);
  });

  it('refuses bad data, a bad body and a missing key before touching the order', async () => {
    const bad = await ask({ payload: { ...DATA, cfdiUse: 'Z99' } });
    expect(bad.json().detail).toBe('INVALID_CFDI_USE_REJECT');
    const body = await ask({ payload: { ...DATA, emailForInvoice: 'no' } });
    expect(body.json().detail).toBe('INVALID_REQUEST');
    expect((await ask({ key: null })).json().detail).toBe('IDEMP_KEY_MISSING');
    expect((await ask({ target: keyless })).statusCode).toBe(503);
    expect(store.inserted).toEqual([]);
  });

  it('says where the latest request stands, with its reason', async () => {
    const empty = { rejection_reason: null, cancellation_reason: null };
    store.state = [{ status: null, ...empty }];
    expect((await send('GET', OWN)).json()).toEqual({
      status: null,
      reason: null,
    });
    store.state = [
      { status: 'REJECTED', ...empty, rejection_reason: 'RFC no coincide' },
    ];
    expect((await send('GET', OWN)).json().reason).toBe('RFC no coincide');
    store.state = [
      { status: 'CANCELLED', ...empty, cancellation_reason: 'Error' },
    ];
    expect((await send('GET', OWN)).json().reason).toBe('Error');
    store.state = [];
    expect((await send('GET', OWN)).statusCode).toBe(404);
    expect(
      (await send('GET', '/v1/account/orders/x/invoice-request')).statusCode
    ).toBe(404);
  });
});

describe('the staff and the queue (FC 077 F2)', () => {
  it('files a request for an order without an account', async () => {
    store.order = { ...ownOrder(), user_id: null };
    expect((await askForSomeone()).statusCode).toBe(201);
    expect(store.inserted[1]).toBeNull();
  });

  it('refuses an order whose buyer has an account, a wrong body and a wrong number', async () => {
    expect((await askForSomeone()).json().detail).toBe(
      'ORDER_BELONGS_TO_ACCOUNT_REJECT'
    );
    expect((await askForSomeone({ payload: DATA })).statusCode).toBe(400);
    const wrong = await askForSomeone({
      payload: { ...DATA, orderNumber: 'x' },
    });
    expect(wrong.statusCode).toBe(404);
  });

  it('is closed to a buyer', async () => {
    expect((await askForSomeone({ who: 'b' })).statusCode).toBe(403);
    expect((await send('GET', STAFF)).statusCode).toBe(403);
  });

  it('reads the queue opened for the staff, filtered and paged', async () => {
    await ask();
    const answer = await send(
      'GET',
      `${STAFF}?status=PENDING&search=xaxx010101000&page=2`,
      { who: 's' }
    );
    expect(answer.statusCode).toBe(200);
    expect(answer.json()).toMatchObject({
      total: 1,
      page: 2,
      pageSize: 50,
      items: [
        {
          id: 12,
          totalMxnCents: 200000,
          invoicableMxnCents: 155000,
          legalName: DATA.legalName,
          postalCode: DATA.postalCode,
          email: DATA.emailForInvoice,
          reason: null,
        },
      ],
    });
    expect(store.queueParams).toEqual([
      'PENDING',
      'PENDING',
      'XAXX010101000',
      'XAXX010101000',
      'XAXX010101000',
      50,
      50,
    ]);
    await send('GET', STAFF, { who: 's' });
    expect(store.queueParams.slice(0, 3)).toEqual([null, null, null]);
  });

  it('refuses an unknown filter, and answers 503 without the keys', async () => {
    const odd = await send('GET', `${STAFF}?status=LOST`, { who: 's' });
    expect(odd.statusCode).toBe(400);
    const closed = await send('GET', STAFF, { who: 's', target: keyless });
    expect(closed.statusCode).toBe(503);
  });
});
