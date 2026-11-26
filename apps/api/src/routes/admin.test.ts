/**
 * FC 070 F1 evidence of the payments probe (T2.2): `GET /v1/admin/payments/health` answers only
 * behind the three levels of the guard (session, authenticator, `orders:read`), reports the mode
 * and each processor and carries no secret, while the public `GET /health` keeps its shape.
 *
 * The database is an in-memory table of handlers keyed by the start of each statement, so the
 * real guard and route run unchanged.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { tokenHash } from '../services/authCrypto';
import type { Db, Transactional } from '../services/db';
import type { PaymentProcessorPort } from '../services/paymentPort';

const KEY = Buffer.alloc(32, 7);
const NOW = new Date('2026-11-23T18:00:00Z');

const READER = 'a0000000-0000-4000-8000-000000000003';
const NO_TOTP = 'a0000000-0000-4000-8000-000000000002';
const NO_PERMISSION = 'a0000000-0000-4000-8000-000000000005';

/** Cookies: `r` holds orders:read, `n` has no authenticator, `x` lacks the permission. */
const TOKENS = new Map([
  [tokenHash('r'.repeat(43)), READER],
  [tokenHash('n'.repeat(43)), NO_TOTP],
  [tokenHash('x'.repeat(43)), NO_PERMISSION],
]);
const session = (letter: string) =>
  `__Host-yekora_session=${letter.repeat(43)}`;

const ROLE_OF: Record<string, string> = {
  [READER]: 'reader',
  [NO_TOTP]: 'admin',
  [NO_PERMISSION]: 'nobody',
};
const PERMISSIONS: Record<string, string[]> = {
  reader: ['account:self', 'orders:read'],
  admin: ['account:self', 'orders:read'],
  nobody: ['account:self'],
};

type Handler = (params: readonly unknown[]) => unknown[];

/** Whether the alert log answers; without it the alert fails and only the log says so. */
let alertLog = false;
/** Statements that queued mail, to see the alert. */
const queued: unknown[] = [];
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
  ['SELECT COUNT(*) AS n FROM audit_log', () => (alertLog ? [{ n: 0 }] : [])],
  ['SELECT DISTINCT u.id', () => [{ id: 'owner-1' }]],
  [
    'INSERT INTO outbox_events',
    (p) => {
      queued.push(p[0]);
      return [];
    },
  ],
  [
    'SELECT is_totp_enabled',
    (p) => [{ is_totp_enabled: p[0] === NO_TOTP ? 0 : 1 }],
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

/** A processor whose ping answers `answer`. */
const processor = (answer: boolean): PaymentProcessorPort => ({
  createSession: vi.fn(),
  verifyWebhook: vi.fn(),
  fetchPayment: vi.fn(),
  ping: vi.fn(async () => answer),
});

let app: FastifyInstance;
const stripe = processor(true);
const mercadoPago = processor(false);

beforeAll(async () => {
  app = await buildApp({
    config: loadConfig({
      DB_HOST: '127.0.0.1',
      DB_USER: 'root',
      DB_NAME: 'yekora_dev',
      AUTH_SECRET: KEY.toString('base64'),
      TOTP_ENCRYPTION_KEY: KEY.toString('base64'),
      PAYMENTS_MODE: 'live',
    }),
    db,
    rate: async () => null,
    logger: false,
    now: () => NOW,
    processors: { STRIPE: stripe, MERCADO_PAGO: mercadoPago },
  });
  await app.ready();
}, 30_000);

afterAll(async () => {
  await app.close();
});

const probe = (cookie?: string) =>
  app.inject({
    method: 'GET',
    url: '/v1/admin/payments/health',
    headers: cookie ? { cookie } : {},
  });

describe('GET /v1/admin/payments/health (FC 070 T2.2)', () => {
  it('reports the mode and each processor to a session with orders:read and its second factor', async () => {
    const answer = await probe(session('r'));
    expect(answer.statusCode).toBe(200);
    expect(answer.json()).toEqual({
      status: 'degraded',
      mode: 'live',
      processors: { stripe: 'ok', mercadoPago: 'unreachable' },
    });
    expect(stripe.ping).toHaveBeenCalledTimes(1);
  });

  it('tells the owner about a processor that did not answer, without changing the report (FC 075 T2.4)', async () => {
    alertLog = true;
    const answer = await probe(session('r'));
    alertLog = false;
    expect(answer.statusCode).toBe(200);
    expect(queued).toEqual(['PAYMENTS_PROBE_FAILED']);
  });

  it('carries no secret and no detail of the processors', async () => {
    const text = (await probe(session('r'))).body;
    expect(text).not.toMatch(/sk_|rk_|whsec|APP_USR|TEST-|Bearer/);
  });

  it.each([
    ['no session', undefined, 401],
    ['an administrator without authenticator', session('n'), 403],
    ['a session without orders:read', session('x'), 403],
  ])(
    'refuses %s with %i, without asking any processor',
    async (_name, cookie, status) => {
      vi.mocked(stripe.ping).mockClear();
      const answer = await probe(cookie);
      expect(answer.statusCode).toBe(status);
      expect(stripe.ping).not.toHaveBeenCalled();
    }
  );

  it('the public /health keeps its shape and says nothing of the processors', async () => {
    const answer = await app.inject({ method: 'GET', url: '/health' });
    expect(answer.statusCode).toBe(200);
    const body = answer.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      'db',
      'sha',
      'status',
      'version',
    ]);
    expect(JSON.stringify(body)).not.toMatch(/stripe|mercado|payments/i);
  });
});
