import type { FastifyInstance } from 'fastify';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { tokenHash } from '../services/checkoutCrypto';
import type { Db, Transactional } from '../services/db';

const BASE_ENV = {
  DB_HOST: '127.0.0.1',
  DB_USER: 'root',
  DB_NAME: 'yekora_dev',
};
const PEPPER = 'o'.repeat(32);
const config = loadConfig({
  ...BASE_ENV,
  CHECKOUT_PII_KEY: Buffer.alloc(32, 5).toString('base64'),
  CUSTOMER_EMAIL_HMAC_PEPPER: 'e'.repeat(32),
  ORDER_TOKEN_PEPPER: PEPPER,
});
const NOW = new Date('2026-10-21T19:00:00Z');
const ORDER = 'YEK-2026-AB12CD34';
const TOKEN = 'k'.repeat(43);

/** One pending order, read with the statement of the route; the SQL sent is recorded. */
function orderDb(paidAt: Date | null = null) {
  const sql: { text: string; params: readonly unknown[] }[] = [];
  const row = {
    order_number: ORDER,
    status: paidAt === null ? 'PENDING_PAYMENT' : 'PAID',
    method: 'OXXO',
    items_total_mxn_cents: '185000',
    shipping_total_mxn_cents: '15000',
    total_mxn_cents: '200000',
    expires_at: new Date('2026-10-24T19:00:00Z'),
    paid_at: paidAt,
    access_token_hash: tokenHash(PEPPER, TOKEN),
  };
  const db: Db & Transactional = {
    async query<Row>(text: string, params: readonly unknown[] = []) {
      sql.push({ text, params });
      if (text.startsWith('SELECT o.order_number')) {
        return (params[0] === ORDER ? [row] : []) as Row[];
      }
      return [] as Row[];
    },
    ping: async () => undefined,
    transaction(work) {
      return work(this);
    },
    close: async () => undefined,
  };
  return { db, sql };
}

let app: FastifyInstance;

async function makeApp(db: Db & Transactional, withSecrets = true) {
  app = await buildApp({
    config: withSecrets ? config : loadConfig(BASE_ENV),
    db,
    rate: async () => null,
    logger: false,
    now: () => NOW,
  });
  return app;
}

function read(
  orderNumber = ORDER,
  authorization: string | null = `Bearer ${TOKEN}`
) {
  return app.inject({
    url: `/v1/orders/${orderNumber}`,
    headers: authorization === null ? {} : { authorization },
  });
}

// Same cold-start budget as app.test.ts.
beforeAll(async () => {
  await (await makeApp(orderDb().db)).inject('/health');
  await app.close();
}, 30_000);

afterEach(async () => {
  await app.close();
});

describe('GET /v1/orders/:order_number', () => {
  it('shows status, method, amounts and times — no personal data — to the token holder', async () => {
    const { db, sql } = orderDb();
    await makeApp(db);
    const res = await read();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      orderNumber: ORDER,
      status: 'PENDING_PAYMENT',
      method: 'OXXO',
      itemsTotalMxnCents: 185000,
      shippingTotalMxnCents: 15000,
      totalMxnCents: 200000,
      expiresAt: '2026-10-24T19:00:00.000Z',
      paidAt: null,
    });
    // Lapsed reservations are released before reading, at the injected clock.
    expect(sql[0]).toEqual({
      text: expect.stringMatching(
        /^SELECT id FROM orders WHERE status_id = 1 AND expires_at < \?/
      ),
      params: [NOW],
    });
  });

  it('reports when a paid order was paid', async () => {
    await makeApp(orderDb(new Date('2026-10-21T19:10:00Z')).db);
    expect((await read()).json()).toMatchObject({
      status: 'PAID',
      paidAt: '2026-10-21T19:10:00.000Z',
    });
  });

  it.each([
    ['an unknown order', 'YEK-2026-ZZZZZZZZ', `Bearer ${TOKEN}`],
    ['a wrong token', ORDER, `Bearer ${'x'.repeat(43)}`],
    ['no token', ORDER, null],
    ['a token of another shape', ORDER, `Bearer ${TOKEN}=`],
    ['another scheme', ORDER, `Basic ${TOKEN}`],
    ['a malformed order number', 'yek-2026-ab12cd34', `Bearer ${TOKEN}`],
  ])(
    'answers the same 404 for %s',
    async (_case, orderNumber, authorization) => {
      const { db, sql } = orderDb();
      await makeApp(db);
      const res = await read(orderNumber, authorization);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({
        type: 'about:blank',
        title: 'Not found',
        status: 404,
      });
      expect(JSON.stringify(sql)).not.toContain(TOKEN);
    }
  );

  it('is closed (503) while the checkout secrets are not configured', async () => {
    const { db, sql } = orderDb();
    await makeApp(db, false);
    const res = await read();
    expect(res.statusCode).toBe(503);
    expect(res.json().detail).toBe('SERVICE_UNAVAILABLE');
    expect(sql).toEqual([]);
  });

  it('allows 30 reads per minute per address, then 429', async () => {
    await makeApp(orderDb().db);
    const codes: number[] = [];
    for (let attempt = 0; attempt < 31; attempt += 1) {
      codes.push((await read()).statusCode);
    }
    expect(codes).toEqual([...Array(30).fill(200), 429]);
  });
});
