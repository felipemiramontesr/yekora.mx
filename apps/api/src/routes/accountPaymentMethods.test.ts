/**
 * FC 054 F0 evidence: the saved cards of an account through `/v1/account/payment-methods*`.
 * T1.1 (setup session gate K, S, V), T1.2 (detach gate K, S, O, M), T2.1 (nothing of a card in the
 * database or the audit trail) and T2.2 (another account's card is a 404, like one that is gone).
 *
 * The database is a small in-memory model answering each statement by its text, and Stripe is a
 * double, so the real guard, routes and services run unchanged.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { PaymentProcessorError } from '../services/paymentPort';
import type { SavedCard } from '../../../../lib/account/paymentMethodTypes';
import type { StripeCardsPort } from '../services/stripeAdapter';
import { tokenHash } from '../services/authCrypto';
import type { Db, Transactional } from '../services/db';

const KEY = Buffer.alloc(32, 7).toString('base64');
const ANA = 'f0000000-0000-4000-8000-000000000001';
const LUIS = 'f0000000-0000-4000-8000-000000000002';
const sessionOf = (letter: string) =>
  `__Host-yekora_session=${letter.repeat(43)}`;
const ANA_COOKIE = sessionOf('a');
const USER_OF: Record<string, string> = { a: ANA, b: LUIS };

/* ---------- the in-memory model ---------- */

const model = {
  links: new Map<string, string>(),
  keys: new Map<string, Record<string, unknown>>(),
  audit: [] as unknown[][],
  statements: [] as string[],
};

type Handler = (p: readonly unknown[]) => unknown[];
const HANDLERS: [string, Handler][] = [
  [
    'SELECT s.id, s.user_id',
    (p) => {
      const letter = Object.keys(USER_OF).find(
        (key) => p[0] === tokenHash(key.repeat(43))
      );
      return letter
        ? [
            {
              id: p[0],
              user_id: USER_OF[letter],
              email: `${letter}@example.test`,
              full_name: 'Persona Prueba',
            },
          ]
        : [];
    },
  ],
  [
    'SELECT ur.role_id',
    () => [{ role_id: 'customer', permission_id: 'account:self' }],
  ],
  ['SELECT is_totp_enabled', () => []],
  [
    'SELECT route, request_hash',
    (p) => {
      const row = model.keys.get(p[0] as string);
      return row ? [row] : [];
    },
  ],
  [
    'INSERT INTO idempotency_keys',
    (p) => {
      model.keys.set(p[0] as string, {
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
    'INSERT INTO audit_log',
    (p) => {
      model.audit.push([...p]);
      return [];
    },
  ],
  [
    'SELECT stripe_customer_id FROM user_stripe_customers',
    (p) => {
      const id = model.links.get(String(p[0]));
      return id === undefined ? [] : [{ stripe_customer_id: id }];
    },
  ],
  [
    'INSERT INTO user_stripe_customers',
    (p) => {
      if (!model.links.has(String(p[0]))) {
        model.links.set(String(p[0]), String(p[1]));
      }
      return [];
    },
  ],
];

const db: Db & Transactional = {
  async query<R>(text: string, params: readonly unknown[] = []) {
    model.statements.push(text);
    const handler = HANDLERS.find(([start]) => text.startsWith(start));
    return (handler ? handler[1](params) : []) as R[];
  },
  ping: async () => undefined,
  transaction(work) {
    return work(this);
  },
  close: async () => undefined,
};

/* ---------- Stripe, as a double ---------- */

const VISA: SavedCard = {
  id: 'pm_visa00000001',
  brand: 'visa',
  last4: '4242',
  expMonth: 12,
  expYear: 2030,
};
const stripe = {
  customers: new Map<string, string>(),
  cards: [] as { card: SavedCard; customer: string }[],
  setups: [] as string[],
  detached: [] as string[],
  failing: false,
};
const guard = () => {
  if (stripe.failing) throw new PaymentProcessorError('Stripe: HTTP 500', 500);
};
const cards: StripeCardsPort = {
  async createCustomer(userId) {
    guard();
    const id = stripe.customers.get(userId) ?? `cus_${userId.slice(-4)}`;
    stripe.customers.set(userId, id);
    return id;
  },
  async listCards(customerId) {
    guard();
    return stripe.cards
      .filter((entry) => entry.customer === customerId)
      .map((entry) => entry.card);
  },
  async cardOwner(paymentMethodId) {
    guard();
    return (
      stripe.cards.find((entry) => entry.card.id === paymentMethodId)
        ?.customer ?? null
    );
  },
  async detachCard(paymentMethodId) {
    guard();
    stripe.detached.push(paymentMethodId);
    stripe.cards = stripe.cards.filter(
      (entry) => entry.card.id !== paymentMethodId
    );
  },
  async createSetupSession({ customerId, successUrl }) {
    guard();
    stripe.setups.push(`${customerId} ${successUrl}`);
    return 'https://checkout.stripe.com/c/pay/cs_test_setup';
  },
};

const BASE = {
  DB_HOST: '127.0.0.1',
  DB_USER: 'root',
  DB_NAME: 'yekora_dev',
  AUTH_SECRET: KEY,
  TOTP_ENCRYPTION_KEY: KEY,
  PUBLIC_SITE_URL: 'https://yekora.mx',
};
const boot = async (withCards: boolean) => {
  const built = await buildApp({
    config: loadConfig(BASE),
    db,
    rate: async () => null,
    logger: false,
    now: () => new Date('2026-11-17T18:00:00Z'),
    ...(withCards && { cards }),
  });
  await built.ready();
  return built;
};

let app: FastifyInstance;
let bare: FastifyInstance;
beforeAll(async () => {
  app = await boot(true);
  bare = await boot(false);
}, 30_000);
afterAll(async () => {
  await app.close();
  await bare.close();
});

beforeEach(() => {
  model.links.clear();
  model.keys.clear();
  model.audit.length = 0;
  model.statements.length = 0;
  stripe.customers.clear();
  stripe.cards = [];
  stripe.setups.length = 0;
  stripe.detached.length = 0;
  stripe.failing = false;
});

let counter = 0;
const send = (
  instance: FastifyInstance,
  method: 'POST' | 'DELETE',
  url: string,
  headers: Record<string, string> = {},
  cookie: string | null = ANA_COOKIE
) =>
  instance.inject({
    method,
    url,
    headers: {
      ...(cookie !== null && { cookie }),
      'idempotency-key': `k-${++counter}`,
      ...headers,
    },
  });
const read = (instance: FastifyInstance, cookie: string | null = ANA_COOKIE) =>
  instance.inject({
    url: '/v1/account/payment-methods',
    ...(cookie !== null && { headers: { cookie } }),
  });
const own = (customer: string, card: SavedCard = VISA) => {
  stripe.cards.push({ card, customer });
};
const linkAna = () => model.links.set(ANA, 'cus_ana');

describe('GET /v1/account/payment-methods', () => {
  it('says there is no customer yet, and asks Stripe nothing, for an account that never saved a card', async () => {
    const res = await read(app);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [], hasCustomer: false });
  });

  it('lists the cards of the account only: brand, last four and expiry, from Stripe', async () => {
    linkAna();
    model.links.set(LUIS, 'cus_luis');
    own('cus_ana');
    own('cus_luis', { ...VISA, id: 'pm_mastercard01', last4: '5100' });
    const res = await read(app);
    expect(res.json()).toEqual({ items: [VISA], hasCustomer: true });
    expect(Object.keys(res.json().items[0]).sort()).toEqual([
      'brand',
      'expMonth',
      'expYear',
      'id',
      'last4',
    ]);
  });

  it('answers 503 without a Stripe key, and 503 when Stripe does not answer', async () => {
    expect((await read(bare)).statusCode).toBe(503);
    linkAna();
    stripe.failing = true;
    const res = await read(app);
    expect(res.statusCode).toBe(503);
    expect(res.json().detail).toBe('SERVICE_UNAVAILABLE');
  });

  it('is behind the session', async () => {
    expect((await read(app, null)).statusCode).toBe(401);
  });

  it('lets an error that is not Stripe’s through as a failure of the server', async () => {
    linkAna();
    const original = cards.listCards;
    cards.listCards = async () => {
      throw new TypeError('bug');
    };
    expect((await read(app)).statusCode).toBe(500);
    cards.listCards = original;
  });
});

describe('POST /v1/account/payment-methods/setup (T1.1 K, S, V)', () => {
  const setup = (instance = app, headers = {}, cookie = ANA_COOKIE) =>
    send(
      instance,
      'POST',
      '/v1/account/payment-methods/setup',
      headers,
      cookie
    );

  it('K S V: creates the customer, links it, and answers the hosted page of Stripe (201)', async () => {
    const res = await setup();
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      redirectUrl: 'https://checkout.stripe.com/c/pay/cs_test_setup',
    });
    expect(model.links.get(ANA)).toBe(`cus_${ANA.slice(-4)}`);
    expect(stripe.setups).toEqual([
      `cus_${ANA.slice(-4)} https://yekora.mx/cuenta/metodos-pago/`,
    ]);
  });

  it('returns the person to the English page when they asked in English', async () => {
    const res = await send(
      app,
      'POST',
      '/v1/account/payment-methods/setup?lang=en',
      {}
    );
    expect(res.statusCode).toBe(201);
    expect(stripe.setups[0]).toContain(
      'https://yekora.mx/en/account/metodos-pago/'
    );
  });

  it('reuses the customer of the account the second time', async () => {
    linkAna();
    await setup();
    expect(stripe.customers.size).toBe(0);
    expect(stripe.setups[0]).toContain('cus_ana');
  });

  it('K S ⊥V: without a session it is 401', async () => {
    const res = await send(
      app,
      'POST',
      '/v1/account/payment-methods/setup',
      {},
      null
    );
    expect(res.statusCode).toBe(401);
  });

  it('K ⊥S V: without a Stripe key it is 503 SERVICE_UNAVAILABLE', async () => {
    const res = await setup(bare);
    expect(res.statusCode).toBe(503);
    expect(res.json().detail).toBe('SERVICE_UNAVAILABLE');
  });

  it('⊥K: a missing or malformed Idempotency-Key is refused before anything else, with a key code', async () => {
    for (const instance of [app, bare]) {
      for (const key of ['', 'not valid!']) {
        const res = await setup(instance, { 'idempotency-key': key });
        expect(res.statusCode).toBe(400);
        expect(res.json().detail).not.toBe('SERVICE_UNAVAILABLE');
      }
    }
    expect(stripe.setups).toEqual([]);
  });

  it('is idempotent: the same key answers the same page and creates nothing twice', async () => {
    const first = await setup(app, { 'idempotency-key': 'same-key' });
    const second = await setup(app, { 'idempotency-key': 'same-key' });
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(stripe.setups).toHaveLength(1);
  });

  it('answers 503 when Stripe does not, stores nothing of the answer, and lets a retry work', async () => {
    stripe.failing = true;
    const failed = await setup(app, { 'idempotency-key': 'retry-key' });
    expect(failed.statusCode).toBe(503);
    expect(model.keys.size).toBe(0);
    stripe.failing = false;
    const retried = await setup(app, { 'idempotency-key': 'retry-key' });
    expect(retried.statusCode).toBe(201);
  });

  it('lets an error that is not Stripe’s through as a failure of the server', async () => {
    const original = cards.createSetupSession;
    cards.createSetupSession = async () => {
      throw new TypeError('bug');
    };
    expect((await setup()).statusCode).toBe(500);
    cards.createSetupSession = original;
  });
});

describe('DELETE /v1/account/payment-methods/:id (T1.2 K, S, O, M)', () => {
  const detach = (
    id = VISA.id,
    instance = app,
    headers = {},
    cookie = ANA_COOKIE
  ) =>
    send(
      instance,
      'DELETE',
      `/v1/account/payment-methods/${id}`,
      headers,
      cookie
    );

  it('K S O M: detaches the card at Stripe, audits it without any card data, and answers 200', async () => {
    linkAna();
    own('cus_ana');
    const res = await detach();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ detached: true });
    expect(stripe.detached).toEqual([VISA.id]);
    expect(model.audit).toHaveLength(1);
    const audited = JSON.stringify(model.audit[0]);
    expect(audited).toContain('PAYMENT_METHOD_DETACHED');
    for (const card of [VISA.id, VISA.last4, 'visa', 'cus_ana']) {
      expect(audited).not.toContain(card);
    }
  });

  it('K S O ⊥M: a card that is not the account’s, or does not exist, is the same 404 and nothing is detached (T2.2)', async () => {
    linkAna();
    model.links.set(LUIS, 'cus_luis');
    own('cus_luis');
    const foreign = await detach();
    const missing = await detach('pm_doesnotexist01');
    for (const res of [foreign, missing]) {
      expect(res.statusCode).toBe(404);
      expect(res.json().detail).toBe('PAYMENT_METHOD_NOT_FOUND');
    }
    expect(foreign.json()).toEqual(missing.json());
    expect(stripe.detached).toEqual([]);
    expect(model.audit).toEqual([]);
  });

  it('K S ⊥O: an account that never saved a card has nothing to detach (404)', async () => {
    own('cus_luis');
    const res = await detach();
    expect(res.statusCode).toBe(404);
    expect(res.json().detail).toBe('PAYMENT_METHOD_NOT_FOUND');
    expect(stripe.detached).toEqual([]);
  });

  it('a malformed id is the same 404, never a lookup', async () => {
    linkAna();
    const res = await detach('not-a-card');
    expect(res.statusCode).toBe(404);
    expect(res.json().detail).toBe('PAYMENT_METHOD_NOT_FOUND');
  });

  it('K ⊥S: without a Stripe key it is 503 SERVICE_UNAVAILABLE', async () => {
    linkAna();
    own('cus_ana');
    const res = await detach(VISA.id, bare);
    expect(res.statusCode).toBe(503);
    expect(res.json().detail).toBe('SERVICE_UNAVAILABLE');
  });

  it('⊥K: a missing or malformed Idempotency-Key is refused first', async () => {
    linkAna();
    own('cus_ana');
    for (const key of ['', 'not valid!']) {
      const res = await detach(VISA.id, app, { 'idempotency-key': key });
      expect(res.statusCode).toBe(400);
    }
    expect(stripe.detached).toEqual([]);
  });

  it('is behind the session (401)', async () => {
    expect((await detach(VISA.id, app, {}, null as never)).statusCode).toBe(
      401
    );
  });

  it('answers 503 when Stripe does not, and detaches nothing', async () => {
    linkAna();
    own('cus_ana');
    stripe.failing = true;
    const res = await detach();
    expect(res.statusCode).toBe(503);
    expect(stripe.detached).toEqual([]);
  });

  it('lets an error that is not Stripe’s through as a failure of the server', async () => {
    linkAna();
    own('cus_ana');
    const original = cards.detachCard;
    cards.detachCard = async () => {
      throw new TypeError('bug');
    };
    expect((await detach()).statusCode).toBe(500);
    cards.detachCard = original;
  });

  it('is idempotent: replaying the key answers the same and detaches once', async () => {
    linkAna();
    own('cus_ana');
    const first = await detach(VISA.id, app, { 'idempotency-key': 'once' });
    const again = await detach(VISA.id, app, { 'idempotency-key': 'once' });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(first.json());
    expect(stripe.detached).toEqual([VISA.id]);
  });
});

describe('what the database keeps of a card (T2.1, T2.3)', () => {
  it('writes only the link to the customer: never a card number, expiry, brand or last four, and never touches the orders', async () => {
    await send(app, 'POST', '/v1/account/payment-methods/setup');
    const writes = model.statements.filter((text) =>
      /^(INSERT|UPDATE|DELETE)/.test(text)
    );
    expect(writes.some((text) => /orders/i.test(text))).toBe(false);
    const own = writes.filter((text) => /user_stripe_customers/.test(text));
    expect(own).toHaveLength(1);
    expect(own[0]).not.toMatch(/brand|last4|exp_|card|pan|cvv/i);
  });
});
