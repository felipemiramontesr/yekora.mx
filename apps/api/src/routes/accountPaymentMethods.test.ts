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
  cards: [] as { card: SavedCard; customer: string; created: number }[],
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
      .map((entry) => ({ ...entry.card, created: entry.created }));
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
// Every request comes from its own address unless a test fixes one, so the limit of ten requests a
// minute (FC 057 T2.5) only ever trips in the tests that mean it to.
let addresses = 0;
const freshAddress = () => {
  const n = addresses++;
  return `10.${Math.floor(n / 250)}.${n % 250}.7`;
};
const send = (
  instance: FastifyInstance,
  method: 'POST' | 'DELETE',
  url: string,
  headers: Record<string, string> = {},
  cookie: string | null = ANA_COOKIE,
  remoteAddress: string = freshAddress()
) =>
  instance.inject({
    method,
    url,
    remoteAddress,
    headers: {
      ...(cookie !== null && { cookie }),
      'idempotency-key': `k-${++counter}`,
      ...headers,
    },
  });
const read = (
  instance: FastifyInstance,
  cookie: string | null = ANA_COOKIE,
  remoteAddress: string = freshAddress()
) =>
  instance.inject({
    remoteAddress,
    url: '/v1/account/payment-methods',
    ...(cookie !== null && { headers: { cookie } }),
  });
// Each card Stripe holds is attached a second later than the one before.
let clock = 1_700_000_000;
const own = (customer: string, card: SavedCard = VISA) => {
  clock += 1;
  stripe.cards.push({ card, customer, created: clock });
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

  it('lists the newest card first when Stripe still holds more than one (FC 057)', async () => {
    linkAna();
    own('cus_ana');
    own('cus_ana', { ...VISA, id: 'pm_mastercard01', brand: 'mastercard' });
    const res = await read(app);
    expect(res.json().items.map((card: { id: string }) => card.id)).toEqual([
      'pm_mastercard01',
      VISA.id,
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
    // Stripe sends the person back with the mark that tells the page to settle the cards (FC 057).
    expect(stripe.setups).toEqual([
      `cus_${ANA.slice(-4)} https://yekora.mx/cuenta/metodos-pago/?setup=done`,
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
      'https://yekora.mx/en/account/metodos-pago/?setup=done'
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

const MASTERCARD: SavedCard = {
  ...VISA,
  id: 'pm_mastercard01',
  brand: 'mastercard',
  last4: '5100',
};
const settle = (
  instance = app,
  headers = {},
  cookie = ANA_COOKIE,
  remoteAddress?: string
) =>
  send(
    instance,
    'POST',
    '/v1/account/payment-methods/settle',
    headers,
    cookie,
    remoteAddress
  );

describe('POST /v1/account/payment-methods/settle (FC 057 T1.1 S, V, D)', () => {
  it('S V D: the first card of an account stays, nothing is detached, and it is audited as saved', async () => {
    linkAna();
    own('cus_ana');
    const res = await settle();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'saved', paymentMethod: VISA });
    expect(stripe.detached).toEqual([]);
    expect(JSON.stringify(model.audit[0])).toContain('PAYMENT_METHOD_SAVED');
  });

  it('S V D: a new card replaces the previous one: the newest stays, the older is detached, and it is audited as replaced (T2.1, T2.6)', async () => {
    linkAna();
    own('cus_ana');
    own('cus_ana', MASTERCARD);
    const res = await settle();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'replaced',
      paymentMethod: MASTERCARD,
    });
    expect(stripe.detached).toEqual([VISA.id]);
    expect((await read(app)).json().items).toEqual([MASTERCARD]);
    const audited = JSON.stringify(model.audit[0]);
    expect(audited).toContain('PAYMENT_METHOD_REPLACED');
    expect(audited).toContain('replaced_payment_method_id');
    expect(audited).toContain('new_payment_method_id');
    // Fingerprints only: no card id, last four, brand or customer in the trail.
    for (const secret of [VISA.id, MASTERCARD.id, '4242', '5100', 'cus_ana']) {
      expect(audited).not.toContain(secret);
    }
  });

  it('keeps one card out of many and detaches all the others', async () => {
    linkAna();
    own('cus_ana');
    own('cus_ana', MASTERCARD);
    own('cus_ana', { ...VISA, id: 'pm_amex000000001', brand: 'amex' });
    const res = await settle();
    expect(res.json().paymentMethod.id).toBe('pm_amex000000001');
    expect([...stripe.detached].sort()).toEqual(
      [VISA.id, MASTERCARD.id].sort()
    );
  });

  it('can be repeated: a second call finds nothing more to detach', async () => {
    linkAna();
    own('cus_ana');
    own('cus_ana', MASTERCARD);
    await settle();
    const again = await settle();
    expect(again.statusCode).toBe(200);
    expect(stripe.detached).toEqual([VISA.id]);
  });

  it('S ⊥V: with no card at Stripe, or no customer yet, it is 400 CARD_ATTACH_FAILED', async () => {
    const noCustomer = await settle();
    linkAna();
    const noCard = await settle();
    for (const res of [noCustomer, noCard]) {
      expect(res.statusCode).toBe(400);
      expect(res.json().detail).toBe('CARD_ATTACH_FAILED');
    }
    expect(model.audit).toEqual([]);
  });

  it('S V ⊥D: when an older card cannot be detached it is 502 GATEWAY_DETACH_FAILED, nothing is audited, and the next call finishes the job', async () => {
    linkAna();
    own('cus_ana');
    own('cus_ana', MASTERCARD);
    const original = cards.detachCard;
    cards.detachCard = async () => {
      throw new PaymentProcessorError('Stripe: HTTP 500', 500);
    };
    const failed = await settle();
    cards.detachCard = original;
    expect(failed.statusCode).toBe(502);
    expect(failed.json().detail).toBe('GATEWAY_DETACH_FAILED');
    expect(model.audit).toEqual([]);
    const retried = await settle();
    expect(retried.statusCode).toBe(200);
    expect(stripe.detached).toEqual([VISA.id]);
  });

  it('⊥S: without a session it is 401', async () => {
    expect((await settle(app, {}, null as never)).statusCode).toBe(401);
  });

  it('never reaches the card of another account (T2.3)', async () => {
    linkAna();
    model.links.set(LUIS, 'cus_luis');
    own('cus_luis');
    const res = await settle();
    expect(res.statusCode).toBe(400);
    expect(stripe.detached).toEqual([]);
  });

  it('answers 503 without a Stripe key and when Stripe does not answer', async () => {
    expect((await settle(bare)).statusCode).toBe(503);
    linkAna();
    stripe.failing = true;
    const res = await settle();
    expect(res.statusCode).toBe(503);
    expect(res.json().detail).toBe('SERVICE_UNAVAILABLE');
  });

  it('lets an error that is not Stripe’s through as a failure of the server', async () => {
    linkAna();
    own('cus_ana');
    own('cus_ana', MASTERCARD);
    const original = cards.detachCard;
    cards.detachCard = async () => {
      throw new TypeError('bug');
    };
    expect((await settle()).statusCode).toBe(500);
    cards.detachCard = original;
  });

  it('⊥K: a missing or malformed Idempotency-Key is refused first, and a replayed key answers the same', async () => {
    linkAna();
    own('cus_ana');
    own('cus_ana', MASTERCARD);
    for (const key of ['', 'not valid!']) {
      expect((await settle(app, { 'idempotency-key': key })).statusCode).toBe(
        400
      );
    }
    const first = await settle(app, { 'idempotency-key': 'once' });
    const again = await settle(app, { 'idempotency-key': 'once' });
    expect(again.json()).toEqual(first.json());
    expect(stripe.detached).toEqual([VISA.id]);
  });

  it('writes nothing to the orders (T2.7)', async () => {
    linkAna();
    own('cus_ana');
    own('cus_ana', MASTERCARD);
    await settle();
    const writes = model.statements.filter((text) =>
      /^(INSERT|UPDATE|DELETE)/.test(text)
    );
    expect(writes.some((text) => /orders/i.test(text))).toBe(false);
  });
});

const SAME_ADDRESS = '203.0.113.9';

describe('the routes of the cards answer 10 requests a minute (FC 057 T2.5)', () => {
  it('refuses the eleventh read in a minute from one address', async () => {
    const fresh = await boot(true);
    try {
      const codes: number[] = [];
      for (let i = 0; i < 11; i += 1)
        codes.push((await read(fresh, ANA_COOKIE, SAME_ADDRESS)).statusCode);
      expect(codes.slice(0, 10).every((code) => code !== 429)).toBe(true);
      expect(codes[10]).toBe(429);
    } finally {
      await fresh.close();
    }
  });

  it('counts each route on its own', async () => {
    const fresh = await boot(true);
    try {
      const codes: number[] = [];
      for (let i = 0; i < 11; i += 1) {
        codes.push(
          (
            await send(
              fresh,
              'POST',
              '/v1/account/payment-methods/setup',
              {},
              ANA_COOKIE,
              SAME_ADDRESS
            )
          ).statusCode
        );
      }
      expect(codes[10]).toBe(429);
      expect(
        (await settle(fresh, {}, ANA_COOKIE, SAME_ADDRESS)).statusCode
      ).not.toBe(429);
    } finally {
      await fresh.close();
    }
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
