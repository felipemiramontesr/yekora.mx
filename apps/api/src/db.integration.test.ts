/**
 * Real-SQL suite (FC 025 T1.2 S): the API's own services against a migrated MariaDB, with the
 * real pool and no fake `Db`. Only the Database (SQL) job runs it (vitest.db.config.ts), after
 * it has applied migrations 001–006 to its `yekora_ci` service.
 *
 * The payment processors are stand-ins: they live outside the database, and what is under test
 * is the SQL around them. The tests share one database and run in order.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PaymentsConfig } from './config';
import { auditTrail, recordAudit } from './services/audit';
import {
  findProduct,
  findProductMedia,
  listProducts,
} from './services/catalog';
import { createCheckout, expireOverdueOrders } from './services/checkout';
import { codeHash, encryptTotpSecret, newToken } from './services/authCrypto';
import { createDb } from './services/db';
import { runIdempotent } from './services/idempotency';
import { inspectMedia, readMedia, storeMedia } from './services/media';
import {
  capabilitiesOf,
  closeSession,
  createCustomer,
  enableTotp,
  failChallenge,
  findUserByEmail,
  liveChallenge,
  markEmailVerified,
  openChallenge,
  openSession,
  passEmailChallenge,
  savePendingTotp,
  sessionUser,
  totpOf,
  useBackupCode,
} from './services/identity';
import { findOrder, listOrders } from './services/orderReads';
import { enqueueMail } from './services/outbox';
import { createOutboxDispatcher } from './services/outboxDispatcher';
import { hashPassword } from './services/passwords';
import type { PaymentProcessorPort } from './services/paymentPort';
import { createTableRateProvider } from './services/shippingRates';
import type { ShippingRateProvider } from './services/shippingPort';
import { receiveWebhook } from './services/webhooks';

// Refuse any other database: this suite writes products, orders and payments.
const DB_NAME = process.env.DB_NAME;
if (DB_NAME !== 'yekora_ci') {
  throw new Error(
    `db.integration.test.ts runs only on yekora_ci, not ${DB_NAME}`
  );
}

const db = createDb({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: DB_NAME,
});

const NOW = new Date('2026-11-02T18:00:00Z');
const MINUTE = 60_000;

const payments: PaymentsConfig = {
  mode: 'sandbox',
  siteUrl: 'https://yekora.mx',
  apiUrl: 'https://apiv1.yekora.mx',
  stripe: null,
  mercadoPago: null,
  checkout: {
    piiKey: Buffer.alloc(32, 9),
    emailPepper: 'e'.repeat(32),
    tokenPepper: 't'.repeat(32),
  },
};

/** A processor that opens sessions (or refuses to) and reports one paid charge. */
function processor(
  over: Partial<PaymentProcessorPort> = {}
): PaymentProcessorPort {
  return {
    async createSession(request) {
      return {
        reference: `ref-${request.orderNumber}`,
        redirectUrl: 'https://checkout.example/pay',
        remoteExpiresAt: new Date(request.expiresAt.getTime() - 30 * MINUTE),
      };
    },
    verifyWebhook: () => null,
    fetchPayment: async () => {
      throw new Error('no payment');
    },
    ...over,
  };
}

const shipping = createTableRateProvider(db);

const deps = (over: Partial<Parameters<typeof createCheckout>[0]> = {}) => ({
  db,
  rate: async () => null,
  shipping,
  processors: { STRIPE: processor() },
  payments,
  now: () => NOW,
  ...over,
});

/** A card checkout of one line to Zacatecas, at the quoted total. */
const body = (sku: string, quantity: number, total: number) => ({
  items: [{ sku, quantity }],
  method: 'CARD',
  customer: {
    name: 'Ana Flores',
    email: 'ana@example.com',
    phone: '4929421780',
  },
  address: {
    street: 'Av. Barones',
    exteriorNumber: '209',
    neighborhood: 'Las Américas',
    municipality: 'Guadalupe',
    stateCode: 'ZAC',
    postalCode: '98612',
  },
  privacyConsent: true,
  expectedTotalMxnCents: total,
});

// 1 850.00 MXN with VAT, plus the flat 150.00 shipping rule below.
const PRICE = 185_000;
const TOTAL_ONE = PRICE + 15_000;

async function stockOf(sku: string) {
  const [row] = await db.query<{ stock: number; reserved_stock: number }>(
    'SELECT stock, reserved_stock FROM products WHERE sku = ?',
    [sku]
  );
  return { stock: Number(row.stock), reserved: Number(row.reserved_stock) };
}

async function orderOf(orderNumber: string) {
  const [row] = await db.query<{
    id: number;
    status_id: number;
    paid_at: Date | null;
  }>('SELECT id, status_id, paid_at FROM orders WHERE order_number = ?', [
    orderNumber,
  ]);
  return {
    id: Number(row.id),
    status: Number(row.status_id),
    paidAt: row.paid_at,
  };
}

/** A checkout that must succeed; returns its order number. */
async function checkout(sku: string, over: Parameters<typeof deps>[0] = {}) {
  const outcome = await createCheckout(
    deps(over),
    body(sku, 1, TOTAL_ONE),
    'es-MX'
  );
  if (!outcome.ok) throw new Error(`checkout refused: ${outcome.code}`);
  return outcome.session.orderNumber;
}

async function addProduct(sku: string, slug: string, stock: number) {
  await db.query(
    "INSERT INTO products (sku, slug, category_id, experience_level_id, name_es, name_en, description_es, description_en, price_mxn_cents, stock, weight_grams, length_mm, width_mm, height_mm, shipping_class_id) SELECT ?, ?, c.id, l.id, 'Mochila de prueba', 'Test backpack', 'Producto de la suite de SQL real.', 'Real-SQL suite product.', ?, ?, 1200, 500, 300, 200, k.id FROM categories c JOIN experience_levels l ON l.slug = 'principiante' JOIN shipping_classes k ON k.slug = 'estandar' WHERE c.slug = 'senderismo'",
    [sku, slug, PRICE, stock]
  );
}

beforeAll(async () => {
  await db.query(
    'INSERT INTO shipping_configs (id, active_strategy_id, is_free_shipping_active) VALUES (1, 1, 0)'
  );
  await db.query(
    'INSERT INTO shipping_rules (strategy_id, rate_mxn_cents) VALUES (1, 15000)'
  );
  await addProduct('ITEST-PACK', 'itest-pack', 5);
  await addProduct('ITEST-LAST', 'itest-last', 1);
});

afterAll(async () => {
  await db.close();
});

describe('catalog (catalog.ts)', () => {
  it('lists and finds the active products through their category and level joins', async () => {
    const page = await listProducts(db, {
      discipline: 'senderismo',
      level: null,
      sort: 'name',
      lang: 'es-MX',
      page: 1,
      pageSize: 24,
    });
    expect(page.items.map((p) => p.sku)).toEqual(
      expect.arrayContaining(['ITEST-PACK', 'ITEST-LAST'])
    );
    expect(page.total).toBeGreaterThanOrEqual(2);
    const found = await findProduct(db, 'itest-pack');
    expect(found).toMatchObject({
      sku: 'ITEST-PACK',
      level: 'principiante',
    });
  });
});

describe('checkout (checkout.ts, cartQuote.ts, shippingRates.ts)', () => {
  it('quotes with the real shipping rule, reserves the unit and writes the order and its line', async () => {
    const orderNumber = await checkout('ITEST-PACK');
    expect(await stockOf('ITEST-PACK')).toEqual({ stock: 5, reserved: 1 });
    const order = await orderOf(orderNumber);
    expect(order.status).toBe(1);
    const [line] = await db.query<{
      quantity: number;
      line_total_mxn_cents: number;
    }>(
      'SELECT quantity, line_total_mxn_cents FROM order_items WHERE order_id = ?',
      [order.id]
    );
    expect(line).toMatchObject({ quantity: 1, line_total_mxn_cents: PRICE });
  });

  it('refuses with 409 INSUFFICIENT_STOCK when another buyer takes the last unit after the quote', async () => {
    // The quote has read the stock when shipping is priced; another buyer reserves the unit then.
    const raced: ShippingRateProvider = {
      async quote(request) {
        await db.query(
          'UPDATE products SET reserved_stock = reserved_stock + 1 WHERE sku = ?',
          ['ITEST-LAST']
        );
        return shipping.quote(request);
      },
    };
    const outcome = await createCheckout(
      deps({ shipping: raced }),
      body('ITEST-LAST', 1, TOTAL_ONE),
      'es-MX'
    );
    expect(outcome).toEqual({
      ok: false,
      status: 409,
      code: 'INSUFFICIENT_STOCK',
    });
    // The other buyer's unit stays reserved and nothing of the refused order was kept.
    expect(await stockOf('ITEST-LAST')).toEqual({ stock: 1, reserved: 1 });
    await db.query('UPDATE products SET reserved_stock = 0 WHERE sku = ?', [
      'ITEST-LAST',
    ]);
  });

  it('cancels the order and gives the stock back when the processor fails', async () => {
    const before = await stockOf('ITEST-PACK');
    const failing = processor({
      createSession: async () => {
        throw new Error('processor down');
      },
    });
    const outcome = await createCheckout(
      deps({ processors: { STRIPE: failing } }),
      body('ITEST-PACK', 1, TOTAL_ONE),
      'es-MX'
    );
    expect(outcome).toEqual({
      ok: false,
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
    });
    expect(await stockOf('ITEST-PACK')).toEqual(before);
    const [cancelled] = await db.query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM orders WHERE status_id = 4'
    );
    expect(Number(cancelled.n)).toBe(1);
  });

  it('expires overdue orders with the UPDATE … JOIN and releases their units', async () => {
    const orderNumber = await checkout('ITEST-PACK');
    const reserved = (await stockOf('ITEST-PACK')).reserved;
    const [method] = await db.query<{ hold_minutes: number }>(
      "SELECT hold_minutes FROM payment_methods WHERE code = 'CARD'"
    );
    const later = new Date(
      NOW.getTime() + (Number(method.hold_minutes) + 1) * MINUTE
    );
    expect(await expireOverdueOrders(db, later)).toBe(2);
    expect((await orderOf(orderNumber)).status).toBe(3);
    expect((await stockOf('ITEST-PACK')).reserved).toBe(reserved - 2);
  });
});

describe('webhook settlement (webhooks.ts)', () => {
  it('marks the order PAID, sells its stock, records the event once and ignores the replay', async () => {
    const orderNumber = await checkout('ITEST-PACK');
    const before = await stockOf('ITEST-PACK');
    const stripe = processor({
      verifyWebhook: () => ({
        eventId: 'evt_itest_1',
        type: 'checkout.session.completed',
        resourceId: 'cs_itest_1',
      }),
      fetchPayment: async () => ({
        paid: true,
        amountMxnCents: TOTAL_ONE,
        currency: 'MXN',
        orderNumber,
        processorStatus: 'paid',
      }),
    });
    const webhookDeps = {
      db,
      processors: { STRIPE: stripe },
      payments,
      now: () => NOW,
    };
    const input = { rawBody: Buffer.from('{}'), headers: {}, query: {} };

    expect(await receiveWebhook(webhookDeps, 'STRIPE', input)).toEqual({
      status: 200,
      code: 'ORDER_PAID',
    });
    const order = await orderOf(orderNumber);
    expect(order.status).toBe(2);
    expect(order.paidAt).not.toBeNull();
    expect(await stockOf('ITEST-PACK')).toEqual({
      stock: before.stock - 1,
      reserved: before.reserved - 1,
    });

    expect(await receiveWebhook(webhookDeps, 'STRIPE', input)).toEqual({
      status: 200,
      code: 'IDEMPOTENT_IGNORED',
    });
    const [events] = await db.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM payment_events WHERE event_id = 'evt_itest_1'"
    );
    expect(Number(events.n)).toBe(1);
    expect((await stockOf('ITEST-PACK')).stock).toBe(before.stock - 1);
  });
});

describe('constraints MariaDB enforces (CHECK and FOREIGN KEY)', () => {
  // The message names the constraint. The error code is not used: mysql2 labels MariaDB's 4025
  // (CHECK failed) with the name MySQL gives that number, which is another error.
  it.each([
    [
      'more units reserved than in stock (ck_products_reserved)',
      "UPDATE products SET reserved_stock = stock + 1 WHERE sku = 'ITEST-PACK'",
      'ck_products_reserved',
    ],
    [
      'an order total that is not items plus shipping (ck_orders_total)',
      'UPDATE orders SET total_mxn_cents = total_mxn_cents + 1 WHERE status_id = 2',
      'ck_orders_total',
    ],
    [
      'a paid order without its payment date (ck_orders_paid_at)',
      'UPDATE orders SET paid_at = NULL WHERE status_id = 2',
      'ck_orders_paid_at',
    ],
    [
      'a product in a category that does not exist (fk_products_category)',
      "UPDATE products SET category_id = 65535 WHERE sku = 'ITEST-PACK'",
      'fk_products_category',
    ],
  ])('rejects %s', async (_case, sql, constraint) => {
    await expect(db.query(sql)).rejects.toThrow(`CONSTRAINT \`${constraint}\``);
  });
});

describe('identity schema of migration 004 (FC 028 F0)', () => {
  const USER = '00000000-0000-4000-8000-000000000028';
  const ARGON =
    '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA';

  it('gives admin the union of every permission, and each other role its own set', async () => {
    const [{ missing }] = await db.query<{ missing: number }>(
      "SELECT COUNT(*) AS missing FROM permissions p WHERE NOT EXISTS (SELECT 1 FROM role_permissions r WHERE r.role_id = 'admin' AND r.permission_id = p.id)"
    );
    expect(Number(missing)).toBe(0);
    const customer = await db.query<{ permission_id: string }>(
      "SELECT permission_id FROM role_permissions WHERE role_id = 'customer'"
    );
    expect(customer.map((row) => row.permission_id)).toEqual(['account:self']);
  });

  it('stores only Argon2id password hashes (ck_users_hash)', async () => {
    await expect(
      db.query(
        "INSERT INTO users (id, email, password_hash, full_name) VALUES ('00000000-0000-4000-8000-0000000000aa', 'plain@example.test', 'secret', 'Plain')"
      )
    ).rejects.toThrow('CONSTRAINT `ck_users_hash`');
    await db.query(
      "INSERT INTO users (id, email, password_hash, full_name) VALUES (?, 'buyer@example.test', ?, 'Comprador de prueba')",
      [USER, ARGON]
    );
  });

  it('links an order to its buyer and keeps the order when the user is deleted (T2.7)', async () => {
    const [order] = await db.query<{ id: number }>(
      'SELECT id FROM orders ORDER BY id LIMIT 1'
    );
    await db.query('UPDATE orders SET user_id = ? WHERE id = ?', [
      USER,
      order.id,
    ]);
    await db.query(
      "INSERT INTO user_roles (user_id, role_id) VALUES (?, 'customer')",
      [USER]
    );
    await db.query('DELETE FROM users WHERE id = ?', [USER]);
    const [kept] = await db.query<{ user_id: string | null }>(
      'SELECT user_id FROM orders WHERE id = ?',
      [order.id]
    );
    expect(kept.user_id).toBeNull();
    const [{ roles }] = await db.query<{ roles: number }>(
      'SELECT COUNT(*) AS roles FROM user_roles WHERE user_id = ?',
      [USER]
    );
    expect(Number(roles)).toBe(0);
  });

  it.each([
    [
      'an outbox payload that is not JSON (ck_outbox_events_payload)',
      "INSERT INTO outbox_events (event_type, payload) VALUES ('AUTH_2FA_EMAIL', 'not json')",
      'ck_outbox_events_payload',
    ],
    [
      'an outbox status outside its life cycle (ck_outbox_events_status)',
      "INSERT INTO outbox_events (event_type, payload, status) VALUES ('AUTH_2FA_EMAIL', '{}', 'LOST')",
      'ck_outbox_events_status',
    ],
  ])('rejects %s', async (_case, sql, constraint) => {
    await expect(db.query(sql)).rejects.toThrow(`CONSTRAINT \`${constraint}\``);
  });

  it('accepts only EMAIL and TOTP challenges (ck_two_factor_challenges_type)', async () => {
    const user = '00000000-0000-4000-8000-0000000000bb';
    await db.query(
      "INSERT INTO users (id, email, password_hash, full_name) VALUES (?, 'challenge@example.test', ?, 'Reto')",
      [user, ARGON]
    );
    await expect(
      db.query(
        "INSERT INTO two_factor_challenges (id, user_id, challenge_type, code_hash, expires_at) VALUES (UUID(), ?, 'SMS', REPEAT('0', 64), UTC_TIMESTAMP())",
        [user]
      )
    ).rejects.toThrow('CONSTRAINT `ck_two_factor_challenges_type`');
  });
});

describe('identity repository on real SQL (identity.ts, FC 028 F0)', () => {
  const SECRET = Buffer.alloc(32, 3);
  const NOW = new Date();
  let userId = '';

  it('creates a buyer with the customer role once, and refuses the same e-mail again', async () => {
    const passwordHash = await hashPassword('correct horse battery staple');
    const user = { email: 'real@example.test', passwordHash, fullName: 'Real' };
    expect(await createCustomer(db, user)).toBe(true);
    expect(await createCustomer(db, user)).toBe(false);
    const found = await findUserByEmail(db, 'real@example.test');
    userId = String(found?.id);
    expect(await capabilitiesOf(db, userId)).toEqual({
      roles: ['customer'],
      permissions: ['account:self'],
      totpEnabled: false,
    });
  });

  it('gives an admin the union of every permission through the joins', async () => {
    await db.query(
      "INSERT INTO user_roles (user_id, role_id) VALUES (?, 'admin')",
      [userId]
    );
    const { roles, permissions } = await capabilitiesOf(db, userId);
    expect(roles).toEqual(['admin', 'customer']);
    expect(permissions).toEqual([
      'account:self',
      'audit:read',
      'catalog:write',
      'orders:read',
      'users:manage',
    ]);
    await db.query(
      "DELETE FROM user_roles WHERE user_id = ? AND role_id = 'admin'",
      [userId]
    );
  });

  it('spends a challenge after its attempts, and forgets an expired one', async () => {
    const id = await openChallenge(db, SECRET, userId, NOW);
    expect(await liveChallenge(db, id, NOW)).toEqual({
      id,
      userId,
      type: 'TOTP',
      codeHash: codeHash(SECRET, id),
      attempts: 0,
    });
    for (let i = 0; i < 5; i++) await failChallenge(db, id);
    expect(await liveChallenge(db, id, NOW)).toBeNull();
    const later = await openChallenge(db, SECRET, userId, NOW);
    expect(
      await liveChallenge(db, later, new Date(NOW.getTime() + 6 * 60_000))
    ).toBeNull();
  });

  it('enables TOTP with 8 backup codes and spends each code exactly once', async () => {
    await savePendingTotp(db, userId, 'v1:aaaa:bbbb:cccc');
    await savePendingTotp(db, userId, 'v1:dddd:eeee:ffff');
    expect(await totpOf(db, userId)).toEqual({
      encrypted: 'v1:dddd:eeee:ffff',
      enabled: false,
    });
    const codes = ['11111111', '22222222'];
    await db.transaction((tx) =>
      enableTotp(
        tx,
        userId,
        codes.map((c) => codeHash(SECRET, c))
      )
    );
    expect((await totpOf(db, userId))?.enabled).toBe(true);
    expect(
      await useBackupCode(db, userId, codeHash(SECRET, '11111111'), NOW)
    ).toBe(true);
    expect(
      await useBackupCode(db, userId, codeHash(SECRET, '11111111'), NOW)
    ).toBe(false);
    expect(
      await useBackupCode(db, userId, codeHash(SECRET, '99999999'), NOW)
    ).toBe(false);
  });

  it('opens a session that finds its user, and closes it', async () => {
    const challengeId = await openChallenge(db, SECRET, userId, NOW);
    const { token, maxAgeSeconds } = await db.transaction((tx) =>
      openSession(tx, {
        challengeId,
        userId,
        privileged: false,
        ip: '203.0.113.7',
        userAgent: 'suite',
        now: NOW,
      })
    );
    expect(maxAgeSeconds).toBe(28_800);
    expect(await liveChallenge(db, challengeId, NOW)).toBeNull();
    const user = await sessionUser(db, token, NOW);
    expect(user).toMatchObject({
      userId,
      email: 'real@example.test',
      totpEnabled: true,
    });
    expect(await sessionUser(db, newToken(), NOW)).toBeNull();
    expect(
      await sessionUser(db, token, new Date(NOW.getTime() + 9 * 3_600_000))
    ).toBeNull();
    await closeSession(db, String(user?.sessionId));
    expect(await sessionUser(db, token, NOW)).toBeNull();
  });
});

describe('order reads and audit trail on real SQL (orderReads.ts, audit.ts, FC 028 F1)', () => {
  let owner = '';
  let paid = '';

  it('lists a buyer’s orders by user_id and shows one with its lines and payment events', async () => {
    const passwordHash = await hashPassword('orders suite passphrase');
    await createCustomer(db, {
      email: 'orders@example.test',
      passwordHash,
      fullName: 'Orders',
    });
    owner = String((await findUserByEmail(db, 'orders@example.test'))?.id);
    const [row] = await db.query<{ order_number: string }>(
      'SELECT order_number FROM orders WHERE status_id = 2 ORDER BY id LIMIT 1'
    );
    paid = row.order_number;
    await db.query('UPDATE orders SET user_id = ? WHERE order_number = ?', [
      owner,
      paid,
    ]);
    const mine = await listOrders(
      db,
      { userId: owner },
      { page: 1, pageSize: 20 }
    );
    expect(mine.total).toBe(1);
    expect(mine.items.map((item) => item.orderNumber)).toEqual([paid]);
    const found = await findOrder(db, paid);
    expect(found?.ownerId).toBe(owner);
    expect(found?.order).toMatchObject({ status: 'PAID', method: 'CARD' });
    expect(found?.order.lines).toEqual([
      expect.objectContaining({ sku: 'ITEST-PACK', quantity: 1 }),
    ]);
    expect(found?.order.paymentEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          processor: 'STRIPE',
          resultingStatus: 'PAID',
        }),
      ])
    );
    expect(await findOrder(db, 'YEK-2026-NOPE0000')).toBeNull();
  });

  it('lists every order for the panel, or those of one status', async () => {
    const all = await listOrders(
      db,
      { status: null },
      { page: 1, pageSize: 50 }
    );
    const onlyPaid = await listOrders(
      db,
      { status: 'PAID' },
      { page: 1, pageSize: 50 }
    );
    expect(onlyPaid.total).toBeGreaterThanOrEqual(1);
    expect(all.total).toBeGreaterThan(onlyPaid.total);
    expect(new Set(onlyPaid.items.map((item) => item.status))).toEqual(
      new Set(['PAID'])
    );
  });

  it('writes the audit trail as valid JSON, and keeps it and the order when the user is gone (ON DELETE SET NULL)', async () => {
    const request = {
      user: { userId: owner },
      routeOptions: { url: '/v1/admin/orders/:order_number' },
      method: 'GET',
      params: { order_number: paid },
      query: { q: 'ana@example.com' },
      ip: '203.0.113.7',
      log: { error: () => undefined },
    } as unknown as FastifyRequest;
    await auditTrail(db).call(undefined as never, request, {
      statusCode: 200,
    } as FastifyReply);
    const [entry] = await db.query<{ id: number; after_state: string }>(
      'SELECT id, after_state FROM audit_log WHERE user_id = ? AND entity_id = ?',
      [owner, paid]
    );
    expect(JSON.parse(entry.after_state)).toEqual({
      query: { q: '[redacted]' },
      status: 200,
    });
    // Removing the account keeps its trail and its purchase, both unlinked (T2.7).
    await db.query('DELETE FROM users WHERE id = ?', [owner]);
    const [kept] = await db.query<{ user_id: string | null }>(
      'SELECT user_id FROM audit_log WHERE id = ?',
      [entry.id]
    );
    expect(kept.user_id).toBeNull();
    expect((await findOrder(db, paid))?.ownerId).toBeNull();
  });
});

describe('mailed code and outbox on real SQL (identity.ts, outbox.ts, outboxDispatcher.ts, FC 028 F1)', () => {
  const SECRET = Buffer.alloc(32, 5);
  const KEY = Buffer.alloc(32, 6);
  const NOW = new Date();
  let userId = '';

  it('opens an EMAIL challenge and its mail in one transaction, then passes it on to TOTP', async () => {
    const passwordHash = await hashPassword('outbox suite passphrase');
    await createCustomer(db, {
      email: 'outbox@example.test',
      passwordHash,
      fullName: 'Outbox',
    });
    userId = String((await findUserByEmail(db, 'outbox@example.test'))?.id);
    const challengeId = await db.transaction(async (tx) => {
      const id = await openChallenge(tx, SECRET, userId, NOW, '482913');
      await enqueueMail(tx, {
        type: 'SIGN_IN_CODE',
        userId,
        challengeId: id,
        code: encryptTotpSecret(KEY, id, Buffer.from('482913')),
      });
      return id;
    });
    expect(await liveChallenge(db, challengeId, NOW)).toMatchObject({
      type: 'EMAIL',
      codeHash: codeHash(SECRET, '482913'),
    });
    await markEmailVerified(db, userId, NOW);
    await markEmailVerified(db, userId, new Date(NOW.getTime() + 60_000));
    const [user] = await db.query<{ email_verified_at: Date }>(
      'SELECT email_verified_at FROM users WHERE id = ?',
      [userId]
    );
    expect(
      Math.abs(user.email_verified_at.getTime() - NOW.getTime())
    ).toBeLessThan(1000);
    await passEmailChallenge(db, SECRET, challengeId);
    expect(await liveChallenge(db, challengeId, NOW)).toMatchObject({
      type: 'TOTP',
      codeHash: codeHash(SECRET, challengeId),
    });
  });

  it('rolls the challenge back when its mail cannot be queued (T2.4b)', async () => {
    const before = await db.query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM two_factor_challenges WHERE user_id = ?',
      [userId]
    );
    await expect(
      db.transaction(async (tx) => {
        await openChallenge(tx, SECRET, userId, NOW, '111111');
        await tx.query(
          'INSERT INTO outbox_events (event_type, payload) VALUES (?, ?)',
          ['SIGN_IN_CODE', 'not json']
        );
      })
    ).rejects.toThrow('ck_outbox_events_payload');
    const after = await db.query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM two_factor_challenges WHERE user_id = ?',
      [userId]
    );
    expect(Number(after[0].n)).toBe(Number(before[0].n));
  });

  it('sends each due message once and records SENT, or the retry and its backoff', async () => {
    await db.transaction((tx) =>
      enqueueMail(tx, { type: 'TOTP_ENABLED', userId })
    );
    const sent: string[] = [];
    let fail = false;
    const outbox = createOutboxDispatcher({
      db,
      totpKey: KEY,
      send: async (message) => {
        if (fail) throw new Error('smtp down');
        sent.push(`${message.to} ${message.subject}`);
      },
      now: () => new Date(Date.now() + 1000),
      log: { error: () => undefined },
      wait: async () => undefined,
    });
    outbox.kick();
    await outbox.drain();
    expect(sent).toEqual([
      'outbox@example.test Tu código de acceso a YĒKORA',
      'outbox@example.test Activaste la verificación en dos pasos en YĒKORA',
    ]);
    const statuses = await db.query<{ status: string; sent_at: Date | null }>(
      "SELECT status, sent_at FROM outbox_events WHERE payload LIKE CONCAT('%', ?, '%') ORDER BY id",
      [userId]
    );
    expect(statuses.map((s) => s.status)).toEqual(['SENT', 'SENT']);
    expect(statuses.every((s) => s.sent_at !== null)).toBe(true);

    fail = true;
    await db.transaction((tx) =>
      enqueueMail(tx, { type: 'TOTP_ENABLED', userId })
    );
    outbox.kick();
    await outbox.drain();
    const [retry] = await db.query<{
      status: string;
      retry_count: number;
      error_message: string;
    }>(
      "SELECT status, retry_count, error_message FROM outbox_events WHERE status <> 'SENT' AND payload LIKE CONCAT('%', ?, '%')",
      [userId]
    );
    expect(retry).toMatchObject({
      status: 'PENDING',
      retry_count: 1,
      error_message: 'smtp down',
    });
  });
});

describe('anti-bot nonces and trusted devices of migration 005 (FC 028 Enmienda 1, T2.10)', () => {
  const hash = (letter: string) => letter.repeat(64);
  const later = new Date(Date.now() + 5 * 60_000);

  it('spends a challenge nonce once: the primary key refuses the replay (T2.8b)', async () => {
    await db.query(
      'INSERT INTO auth_challenge_nonces (nonce_hash, expires_at) VALUES (?, ?)',
      [hash('a'), later]
    );
    await expect(
      db.query(
        'INSERT INTO auth_challenge_nonces (nonce_hash, expires_at) VALUES (?, ?)',
        [hash('a'), later]
      )
    ).rejects.toThrow('Duplicate entry');
    const [key] = await db.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auth_challenge_nonces' AND INDEX_NAME = 'idx_expires' AND COLUMN_NAME = 'expires_at'"
    );
    expect(Number(key.n)).toBe(1);
  });

  it('keeps one row per device token, and drops a user’s devices with the user (CASCADE)', async () => {
    const passwordHash = await hashPassword('trusted devices passphrase');
    await createCustomer(db, {
      email: 'devices@example.test',
      passwordHash,
      fullName: 'Devices',
    });
    const userId = String(
      (await findUserByEmail(db, 'devices@example.test'))?.id
    );
    await db.query(
      'INSERT INTO user_trusted_devices (user_id, device_token_hash, expires_at) VALUES (?, ?, ?)',
      [userId, hash('b'), later]
    );
    await expect(
      db.query(
        'INSERT INTO user_trusted_devices (user_id, device_token_hash, expires_at) VALUES (?, ?, ?)',
        [userId, hash('b'), later]
      )
    ).rejects.toThrow('Duplicate entry');
    await expect(
      db.query(
        'INSERT INTO user_trusted_devices (user_id, device_token_hash, expires_at) VALUES (?, ?, ?)',
        [userId, 'short', later]
      )
    ).rejects.toThrow('ck_user_trusted_devices_hash');
    await db.query('DELETE FROM users WHERE id = ?', [userId]);
    const [left] = await db.query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM user_trusted_devices WHERE user_id = ?',
      [userId]
    );
    expect(Number(left.n)).toBe(0);
  });
});

describe('unified catalog, media and idempotency of migration 006 (FC 029 F0)', () => {
  /** How many rows a query counts. */
  const count = async (sql: string, params: unknown[] = []) =>
    Number((await db.query<{ n: number }>(sql, params))[0].n);
  const sha = (letter: string) => letter.repeat(64);

  it('retires product_images (T0.2, T2.1d)', async () => {
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_images'"
      )
    ).toBe(0);
  });

  it('keys every catalog relation with INT UNSIGNED, like products.id (T2.1a)', async () => {
    const columns = await db.query<{ column_type: string }>(
      "SELECT COLUMN_TYPE AS column_type FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.COLUMNS c ON c.TABLE_SCHEMA = k.TABLE_SCHEMA AND c.TABLE_NAME = k.TABLE_NAME AND c.COLUMN_NAME = k.COLUMN_NAME WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME IN ('products', 'brands', 'product_facet_groups', 'product_facet_values')"
    );
    // product_facet_links (2), product_facet_values, product_media and products.brand_id.
    expect(columns.length).toBeGreaterThanOrEqual(5);
    expect(new Set(columns.map((c) => c.column_type))).toEqual(
      new Set(['int(10) unsigned'])
    );
  });

  it('seeds the system group Nivel with one value per experience level, and never lets it be retired (T2.1b)', async () => {
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM product_facet_values v JOIN product_facet_groups g ON g.id = v.group_id JOIN experience_levels l ON l.slug = v.code WHERE g.code = 'nivel' AND g.is_system = 1"
      )
    ).toBe(await count('SELECT COUNT(*) AS n FROM experience_levels'));
    await expect(
      db.query(
        "UPDATE product_facet_groups SET is_active = 0 WHERE code = 'nivel'"
      )
    ).rejects.toThrow('ck_product_facet_groups_system_active');
  });

  it('links a facet only to an existing product and value, and drops the link with either (T2.1c)', async () => {
    const [{ id: productId }] = await db.query<{ id: number }>(
      "SELECT id FROM products WHERE sku = 'ITEST-PACK'"
    );
    const [{ id: valueId }] = await db.query<{ id: number }>(
      "SELECT v.id FROM product_facet_values v JOIN product_facet_groups g ON g.id = v.group_id WHERE g.code = 'nivel' AND v.code = 'principiante'"
    );
    await db.query(
      'INSERT IGNORE INTO product_facet_links (product_id, value_id) VALUES (?, ?)',
      [productId, valueId]
    );
    await expect(
      db.query(
        'INSERT INTO product_facet_links (product_id, value_id) VALUES (?, ?)',
        [999_999, valueId]
      )
    ).rejects.toThrow('fk_facet_link_prod');
    await expect(
      db.query(
        'INSERT INTO product_facet_links (product_id, value_id) VALUES (?, ?)',
        [productId, 999_999]
      )
    ).rejects.toThrow('fk_facet_link_val');
    // Read the ids back by code instead of INSERT … RETURNING, which needs MariaDB 10.5+
    // (the local XAMPP engine is 10.4; CI and production run 11.8).
    await db.query(
      "INSERT INTO product_facet_groups (code, name_es, name_en) VALUES ('itest', 'Prueba', 'Test')"
    );
    const [{ id: groupId }] = await db.query<{ id: number }>(
      "SELECT id FROM product_facet_groups WHERE code = 'itest'"
    );
    await db.query(
      "INSERT INTO product_facet_values (group_id, code, value_es, value_en) VALUES (?, 'uno', 'Uno', 'One')",
      [groupId]
    );
    const [{ id: tempValue }] = await db.query<{ id: number }>(
      "SELECT id FROM product_facet_values WHERE group_id = ? AND code = 'uno'",
      [groupId]
    );
    await db.query(
      'INSERT INTO product_facet_links (product_id, value_id) VALUES (?, ?)',
      [productId, tempValue]
    );
    await db.query('DELETE FROM product_facet_groups WHERE id = ?', [groupId]);
    expect(
      await count(
        'SELECT COUNT(*) AS n FROM product_facet_links WHERE value_id = ?',
        [tempValue]
      )
    ).toBe(0);
  });

  it('stores each blob once by its SHA-256, only WebP, JPEG or PNG up to 2 MB, and keeps a blob in use (T2.2a, T2.2b)', async () => {
    const insert = (hash: string, mime: string, bytes: Buffer) =>
      db.query(
        'INSERT INTO media_blobs (sha256, mime_type, width, height, size_bytes, media_data) VALUES (?, ?, 300, 300, ?, ?)',
        [hash, mime, bytes.length, bytes]
      );
    await insert(sha('a'), 'image/webp', Buffer.from('webp'));
    await expect(
      insert(sha('a'), 'image/webp', Buffer.from('webp'))
    ).rejects.toThrow('Duplicate entry');
    await expect(
      insert(sha('b'), 'image/svg+xml', Buffer.from('<svg/>'))
    ).rejects.toThrow('ck_media_blobs_mime');
    await expect(
      insert(sha('c'), 'image/png', Buffer.alloc(2_097_153))
    ).rejects.toThrow('ck_media_blobs_size');
    await expect(
      insert('NOT-A-DIGEST'.padEnd(64, 'x'), 'image/png', Buffer.from('png'))
    ).rejects.toThrow('ck_media_blobs_sha256');
    const [{ id: productId }] = await db.query<{ id: number }>(
      "SELECT id FROM products WHERE sku = 'ITEST-PACK'"
    );
    await db.query(
      'INSERT INTO product_media (product_id, media_sha256, is_primary) VALUES (?, ?, 1)',
      [productId, sha('a')]
    );
    await expect(
      db.query('DELETE FROM media_blobs WHERE sha256 = ?', [sha('a')])
    ).rejects.toThrow('fk_media_blob');
  });

  it('keeps one idempotency row per key, for an existing user', async () => {
    await expect(
      db.query(
        "INSERT INTO idempotency_keys (key_hash, user_id, route, request_hash, response_status, response_headers, response_body, expires_at) VALUES (?, 'u-nobody', '/v1/admin/catalog/products', ?, 201, '{}', '{}', NOW())",
        [sha('d'), sha('e')]
      )
    ).rejects.toThrow('fk_idemp_user');
  });
});

describe('catalog backoffice on real SQL (FC 029 F1 and F2a)', () => {
  const sha = (letter: string) => letter.repeat(64);

  /** A PNG header of a canonical size, enough for the probe and the CHECKs of migration 006. */
  function png(width: number, height: number): Buffer {
    const bytes = Buffer.alloc(64);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
    bytes.writeUInt32BE(13, 8);
    bytes.write('IHDR', 12, 'latin1');
    bytes.writeUInt32BE(width, 16);
    bytes.writeUInt32BE(height, 20);
    return bytes;
  }

  it('reads the active gallery of a product, primary first, and a blob by its digest (F1)', async () => {
    const [{ id: productId }] = await db.query<{ id: number }>(
      "SELECT id FROM products WHERE sku = 'ITEST-PACK'"
    );
    for (const letter of ['b', 'c']) {
      await db.query(
        'INSERT INTO media_blobs (sha256, mime_type, width, height, size_bytes, media_data) VALUES (?, ?, 300, 300, 4, ?)',
        [sha(letter), 'image/png', Buffer.from(letter.repeat(4))]
      );
    }
    await db.query(
      "INSERT INTO product_media (product_id, media_sha256, alt_text_es, sort_order, is_primary, is_active) VALUES (?, ?, 'Lado', 1, 0, 1), (?, ?, NULL, 2, 0, 0)",
      [productId, sha('b'), productId, sha('c')]
    );
    const gallery = await findProductMedia(db, 'itest-pack');
    expect(gallery.map((image) => image.sha256)).toEqual([sha('a'), sha('b')]);
    expect(gallery[1]).toMatchObject({
      alt_text_es: 'Lado',
      alt_text_en: null,
    });
    await expect(readMedia(db, sha('b'))).resolves.toEqual({
      mimeType: 'image/png',
      data: Buffer.from('bbbb'),
    });
    await expect(readMedia(db, sha('9'))).resolves.toBeNull();
  });

  it('uploads once per key: stores the blob, its idempotency row and its audit entry together (F2a)', async () => {
    const passwordHash = await hashPassword('catalog suite passphrase');
    await createCustomer(db, {
      email: 'catalog@example.test',
      passwordHash,
      fullName: 'Catalog',
    });
    const userId = String(
      (await findUserByEmail(db, 'catalog@example.test'))?.id
    );
    const image = png(600, 400);
    const verdict = inspectMedia(image, 'image/png');
    if (verdict.code !== 'MEDIA_ACCEPTED') throw new Error(verdict.code);
    const request = {
      userId,
      key: 'itest-upload-1',
      route: 'POST /v1/admin/catalog/media',
      requestHash: sha('1'),
      now: NOW,
    };
    const upload = () =>
      runIdempotent(db, request, async (tx) => {
        const created = await storeMedia(tx, image, verdict);
        await recordAudit(tx, {
          userId,
          action: 'POST /v1/admin/catalog/media',
          entityType: 'media',
          entityId: verdict.sha256,
          before: null,
          after: { created },
          ip: '127.0.0.1',
        });
        return { status: 201, body: { sha256: verdict.sha256, created } };
      });
    await expect(upload()).resolves.toMatchObject({
      code: 'IDEMP_FIRST_EXECUTION',
      answer: { status: 201, body: { created: true } },
    });
    await expect(upload()).resolves.toMatchObject({
      code: 'IDEMP_REPLAY_SUCCESS',
      answer: { status: 201, body: { sha256: verdict.sha256, created: true } },
    });
    await expect(
      runIdempotent(db, { ...request, requestHash: sha('2') }, async () => ({
        status: 201,
        body: {},
      }))
    ).resolves.toEqual({ code: 'IDEMP_PAYLOAD_MISMATCH' });
    const counts = await db.query<{
      blobs: number;
      idem: number;
      audit: number;
    }>(
      "SELECT (SELECT COUNT(*) FROM media_blobs WHERE sha256 = ?) AS blobs, (SELECT COUNT(*) FROM idempotency_keys WHERE user_id = ?) AS idem, (SELECT COUNT(*) FROM audit_log WHERE entity_type = 'media' AND entity_id = ?) AS audit",
      [verdict.sha256, userId, verdict.sha256]
    );
    expect(Object.values(counts[0]).map(Number)).toEqual([1, 1, 1]);
    // A crashed mutation leaves neither its blob nor its key (one transaction, T2.3a).
    await expect(
      runIdempotent(
        db,
        { ...request, key: 'itest-upload-2', requestHash: sha('3') },
        async (tx) => {
          await storeMedia(tx, png(300, 300), {
            ...verdict,
            sha256: sha('7'),
          });
          throw new Error('crash after the insert');
        }
      )
    ).rejects.toThrow('crash after the insert');
    const [left] = await db.query<{ n: number }>(
      'SELECT (SELECT COUNT(*) FROM media_blobs WHERE sha256 = ?) + (SELECT COUNT(*) FROM idempotency_keys WHERE user_id = ? AND route = ? AND request_hash = ?) AS n',
      [sha('7'), userId, request.route, sha('3')]
    );
    expect(Number(left.n)).toBe(0);
  });
});
