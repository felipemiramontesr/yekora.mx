/**
 * Real-SQL suite (FC 025 T1.2 S): the API's own services against a migrated MariaDB, with the
 * real pool and no fake `Db`. Only the Database (SQL) job runs it (vitest.db.config.ts), after
 * it has applied migrations 001–003 to its `yekora_ci` service.
 *
 * The payment processors are stand-ins: they live outside the database, and what is under test
 * is the SQL around them. The tests share one database and run in order.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PaymentsConfig } from './config';
import { findProduct, listProducts } from './services/catalog';
import { createCheckout, expireOverdueOrders } from './services/checkout';
import { createDb } from './services/db';
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
    expect(found?.product).toMatchObject({
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
