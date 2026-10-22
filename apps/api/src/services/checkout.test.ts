import { createDecipheriv } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { PaymentsConfig } from '../config';
import {
  createCheckout,
  expireOverdueOrders,
  type CheckoutDeps,
} from './checkout';
import { tokenHash } from './checkoutCrypto';
import type { Db, Transactional, TxQuery } from './db';
import type { PaymentProcessorPort, SessionRequest } from './paymentPort';
import type { ShipmentQuote, ShippingRateProvider } from './shippingPort';

const NOW = new Date('2026-10-21T19:00:00Z');
const MIN = 60_000;
const PII_KEY = Buffer.alloc(32, 9);
const EMAIL_PEPPER = 'e'.repeat(32);
const TOKEN_PEPPER = 't'.repeat(32);

/**
 * Reads format 1 independently of the production code (which only encrypts): the bytes on disk
 * must be version · IV · ciphertext · tag, with the order and column as additional data.
 */
function openPii(
  key: Buffer,
  orderNumber: string,
  field: string,
  stored: Buffer
) {
  const decipher = createDecipheriv('aes-256-gcm', key, stored.subarray(1, 13));
  decipher.setAAD(Buffer.from(`${orderNumber}|${field}`));
  decipher.setAuthTag(stored.subarray(-16));
  return Buffer.concat([
    decipher.update(stored.subarray(13, -16)),
    decipher.final(),
  ]).toString();
}

interface Product {
  id: number;
  sku: string;
  price: number;
  stock: number;
  reserved: number;
  active: boolean;
}
interface Order {
  id: number;
  params: unknown[];
  status: number;
  expiresAt: Date;
  reference: string | null;
}
interface State {
  products: Product[];
  orders: Order[];
  items: {
    orderId: number;
    productId: number;
    quantity: number;
    params: unknown[];
  }[];
  methods: { code: string; id: number; hold: number; active: boolean }[];
}

/**
 * In-memory MariaDB for the checkout: answers each static statement the service sends, and
 * emulates a transaction by restoring a snapshot when the work throws. `beforeReserve` plays
 * another buyer: what it commits through `outside` survives this request's rollback.
 */
function memoryDb(
  seed: Partial<State> = {},
  hooks: {
    beforeReserve?: (
      s: State,
      outside: (change: (x: State) => void) => void
    ) => void;
    failInsert?: boolean;
  } = {}
) {
  let state: State = {
    products: [
      {
        id: 1,
        sku: 'TENT',
        price: 185000,
        stock: 5,
        reserved: 0,
        active: true,
      },
      { id: 2, sku: 'LAMP', price: 35000, stock: 1, reserved: 0, active: true },
    ],
    orders: [],
    items: [],
    methods: [
      { code: 'CARD', id: 1, hold: 60, active: true },
      { code: 'OXXO', id: 2, hold: 4320, active: true },
      { code: 'SPEI', id: 3, hold: 1440, active: true },
      { code: 'MERCADO_PAGO_BALANCE', id: 4, hold: 60, active: false },
    ],
    ...seed,
  };
  let snapshot: State | null = null;
  const sql: string[] = [];
  const find = (id: number) =>
    state.products.find((p) => p.id === id) as Product;

  const release = (orderIds: number[]) => {
    for (const item of state.items.filter((i) => orderIds.includes(i.orderId)))
      find(item.productId).reserved -= item.quantity;
  };
  const outside = (change: (x: State) => void) => {
    change(state);
    if (snapshot) change(snapshot);
  };
  function reserve([quantity, sku]: unknown[]) {
    hooks.beforeReserve?.(state, outside);
    const product = state.products.find((x) => x.sku === sku && x.active);
    const ok =
      product !== undefined &&
      product.stock - product.reserved >= (quantity as number);
    if (ok) product.reserved += quantity as number;
    return { affectedRows: ok ? 1 : 0 };
  }
  function insertOrder(p: unknown[]) {
    if (hooks.failInsert) throw new Error('connection lost');
    const id = state.orders.length + 1;
    state.orders.push({
      id,
      params: p,
      status: 1,
      expiresAt: p[16] as Date,
      reference: null,
    });
    return { insertId: id };
  }
  function cancel([id]: unknown[]) {
    const order = state.orders.find((o) => o.id === id && o.status === 1);
    if (order) order.status = 4;
    return { affectedRows: order ? 1 : 0 };
  }

  /** Each statement the service sends (by its opening words) and what it does here. */
  const handlers: [string, (p: unknown[]) => unknown][] = [
    [
      'SELECT p.sku, p.slug',
      ([skus]) =>
        state.products
          .filter((x) => x.active && (skus as string[]).includes(x.sku))
          .map((x) => ({
            sku: x.sku,
            slug: x.sku.toLowerCase(),
            name_es: x.sku,
            name_en: x.sku,
            price_mxn_cents: x.price,
            stock: x.stock - x.reserved,
            weight_grams: 1000,
            length_mm: 100,
            width_mm: 100,
            height_mm: 100,
            shipping_class_id: 1,
          })),
    ],
    [
      'SELECT id FROM orders WHERE status_id = 1 AND expires_at < ?',
      ([now]) =>
        state.orders
          .filter((o) => o.status === 1 && o.expiresAt < (now as Date))
          .map((o) => ({ id: o.id })),
    ],
    [
      'UPDATE products p JOIN (SELECT product_id',
      ([ids]) => {
        release(ids as number[]);
        return { affectedRows: (ids as number[]).length };
      },
    ],
    [
      'UPDATE orders SET status_id = 3',
      ([ids]) => {
        for (const o of state.orders)
          if ((ids as number[]).includes(o.id) && o.status === 1) o.status = 3;
        return { affectedRows: 1 };
      },
    ],
    [
      'SELECT id, hold_minutes FROM payment_methods',
      ([code]) =>
        state.methods
          .filter((m) => m.code === code && m.active)
          .map((m) => ({ id: m.id, hold_minutes: m.hold })),
    ],
    ['UPDATE products SET reserved_stock = reserved_stock + ?', reserve],
    [
      'SELECT id FROM products WHERE sku = ?',
      ([sku]) =>
        state.products.filter((x) => x.sku === sku).map((x) => ({ id: x.id })),
    ],
    ['INSERT INTO orders', insertOrder],
    [
      'INSERT INTO order_items',
      (p) => {
        state.items.push({
          orderId: p[0] as number,
          productId: p[1] as number,
          quantity: p[3] as number,
          params: p,
        });
        return { affectedRows: 1 };
      },
    ],
    [
      'UPDATE orders SET processor_reference',
      ([reference, id]) => {
        (state.orders.find((o) => o.id === id) as Order).reference =
          reference as string;
        return { affectedRows: 1 };
      },
    ],
    ['UPDATE orders SET status_id = 4', cancel],
    [
      'UPDATE products p JOIN order_items i',
      ([id]) => {
        release([id as number]);
        return { affectedRows: 1 };
      },
    ],
  ];

  async function query<Row>(
    text: string,
    params: readonly unknown[] = []
  ): Promise<Row[]> {
    sql.push(text);
    const handler = handlers.find(([opening]) => text.startsWith(opening));
    if (handler === undefined) throw new Error(`unexpected SQL: ${text}`);
    return handler[1](params as unknown[]) as Row[];
  }

  const db: Db & Transactional = {
    query,
    ping: async () => undefined,
    close: async () => undefined,
    async transaction<T>(work: (tx: TxQuery) => Promise<T>): Promise<T> {
      const before = structuredClone(state);
      snapshot = before;
      try {
        const result = await work({ query });
        snapshot = null;
        return result;
      } catch (error) {
        state = before;
        snapshot = null;
        throw error;
      }
    },
  };
  return { db, sql, state: () => state };
}

/** Shipping by state: ZAC $150, JAL not served, YUC an inactive zone. */
const shipping: ShippingRateProvider = {
  async quote(request): Promise<ShipmentQuote> {
    if (request.stateCode === 'YUC')
      return { serviceable: false, code: 'INVALID_DESTINATION' };
    if (request.stateCode === 'JAL')
      return { serviceable: false, code: 'UNSERVICEABLE_DESTINATION' };
    return {
      serviceable: true,
      code: 'STANDARD_RATE',
      strategy: 'ZONE_RATE',
      ruleId: 1,
      totalMxnCents: 15000,
      baseMxnCents: 12931,
      taxMxnCents: 2069,
      freeShippingRemainingMxnCents: null,
    };
  },
};

function processor(fail = false) {
  const requests: SessionRequest[] = [];
  const port: PaymentProcessorPort = {
    async createSession(request) {
      requests.push(request);
      if (fail) throw new Error('Stripe: HTTP 500');
      return {
        reference: `ref_${request.orderNumber}`,
        redirectUrl: 'https://checkout.stripe.com/c/pay/x',
        remoteExpiresAt: request.expiresAt,
      };
    },
    verifyWebhook: () => null,
    fetchPayment: vi.fn(),
  };
  return { port, requests };
}

const payments = (over: Partial<PaymentsConfig> = {}): PaymentsConfig => ({
  mode: 'sandbox',
  siteUrl: 'https://yekora.mx',
  apiUrl: 'https://apiv1.yekora.mx',
  stripe: null,
  mercadoPago: null,
  checkout: {
    piiKey: PII_KEY,
    emailPepper: EMAIL_PEPPER,
    tokenPepper: TOKEN_PEPPER,
  },
  ...over,
});

function deps(
  db: Db & Transactional,
  over: Partial<CheckoutDeps> = {}
): CheckoutDeps {
  return {
    db,
    rate: async () => null,
    shipping,
    processors: { STRIPE: processor().port, MERCADO_PAGO: processor().port },
    payments: payments(),
    now: () => NOW,
    ...over,
  };
}

/** A valid body: 1 tent to Zacatecas by card, total 185 000 + 15 000. */
const body = (over: Record<string, unknown> = {}) => ({
  items: [{ sku: 'TENT', quantity: 1 }],
  method: 'CARD',
  customer: {
    name: 'Ana Flores',
    email: 'Ana@Example.com',
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
  expectedTotalMxnCents: 200000,
  ...over,
});

const refused = (status: number, code: string) => ({ ok: false, status, code });

describe('T1.1 · ClientPayloadValid ⟺ K ∧ A ∧ C (K → A → C)', () => {
  const badAddress = { ...body().address, stateCode: 'XYZ' };

  it.each([
    ['A ⊤ C ⊤', body()],
    ['A ⊤ C ⊥', body({ privacyConsent: false })],
    ['A ⊥ C ⊤', body({ address: badAddress })],
    ['A ⊥ C ⊥', body({ address: badAddress, privacyConsent: false })],
  ])(
    'K ⊥ (%s): 503 SERVICE_UNAVAILABLE before reading anything',
    async (_rows, payload) => {
      const { db, sql } = memoryDb();
      const noStripe = deps(db, {
        processors: { MERCADO_PAGO: processor().port },
      });
      await expect(createCheckout(noStripe, payload, 'es-MX')).resolves.toEqual(
        refused(503, 'SERVICE_UNAVAILABLE')
      );
      expect(sql).toEqual([]);
    }
  );

  it('K ⊥ also without the checkout secrets, for every method', async () => {
    const { db } = memoryDb();
    for (const method of ['CARD', 'SPEI']) {
      await expect(
        createCheckout(
          deps(db, { payments: payments({ checkout: null }) }),
          body({ method }),
          'es-MX'
        )
      ).resolves.toEqual(refused(503, 'SERVICE_UNAVAILABLE'));
    }
  });

  it.each([
    ['a state outside the 32', { address: badAddress }],
    [
      'a 9-digit phone',
      { customer: { ...body().customer, phone: '492942178' } },
    ],
    ['an invalid e-mail', { customer: { ...body().customer, email: 'ana' } }],
    [
      'a 4-digit postal code',
      { address: { ...body().address, postalCode: '9861' } },
    ],
    [
      'an unknown address field',
      { address: { ...body().address, gps: '22.7,-102.5' } },
    ],
    [
      'bad data and no consent (A before C)',
      { address: badAddress, privacyConsent: false },
    ],
  ])('K ⊤ A ⊥: %s → 400 INVALID_SHIPPING_ADDRESS', async (_case, over) => {
    const { db, sql } = memoryDb();
    await expect(
      createCheckout(deps(db), body(over), 'es-MX')
    ).resolves.toEqual(refused(400, 'INVALID_SHIPPING_ADDRESS'));
    expect(sql).toEqual([]);
  });

  it('K ⊤ A ⊤ C ⊥: 400 PRIVACY_CONSENT_REQUIRED, stock untouched', async () => {
    const { db, sql } = memoryDb();
    await expect(
      createCheckout(deps(db), body({ privacyConsent: false }), 'es-MX')
    ).resolves.toEqual(refused(400, 'PRIVACY_CONSENT_REQUIRED'));
    expect(sql).toEqual([]);
  });

  it('a malformed request (no method, bad lines, extra keys) is 400 INVALID_REQUEST', async () => {
    const { db } = memoryDb();
    for (const payload of [
      body({ method: 'BITCOIN' }),
      null,
      body({ items: 'tent' }),
      body({ expectedTotalMxnCents: -1 }),
      body({ coupon: 'FREE' }),
    ]) {
      await expect(createCheckout(deps(db), payload, 'es-MX')).resolves.toEqual(
        refused(400, 'INVALID_REQUEST')
      );
    }
  });
});

describe('cart quotable, then T1.2 · SessionCreated ⟺ D ∧ P ∧ I (D → P → I)', () => {
  it('an unknown SKU is 400 EMPTY_OR_UNAVAILABLE_CART', async () => {
    const { db } = memoryDb();
    await expect(
      createCheckout(
        deps(db),
        body({ items: [{ sku: 'NOPE', quantity: 1 }] }),
        'es-MX'
      )
    ).resolves.toEqual(refused(400, 'EMPTY_OR_UNAVAILABLE_CART'));
  });

  it('a state the rate tables do not know is 400 INVALID_SHIPPING_ADDRESS', async () => {
    const { db } = memoryDb();
    const yucatan = body({ address: { ...body().address, stateCode: 'YUC' } });
    await expect(createCheckout(deps(db), yucatan, 'es-MX')).resolves.toEqual(
      refused(400, 'INVALID_SHIPPING_ADDRESS')
    );
  });

  it('D ⊥ (with P ⊥ too): 400 UNSERVICEABLE_DESTINATION comes first', async () => {
    const { db, state } = memoryDb();
    const jalisco = { ...body().address, stateCode: 'JAL' };
    for (const total of [200000, 1]) {
      await expect(
        createCheckout(
          deps(db),
          body({ address: jalisco, expectedTotalMxnCents: total }),
          'es-MX'
        )
      ).resolves.toEqual(refused(400, 'UNSERVICEABLE_DESTINATION'));
    }
    expect(state().orders).toEqual([]);
  });

  it('D ⊤ P ⊥ (with I ⊥ too): 409 PRICE_CHANGED before any reservation', async () => {
    const { db, state, sql } = memoryDb(
      {},
      {
        beforeReserve: (s) => {
          s.products[0].reserved = 5;
        },
      }
    );
    await expect(
      createCheckout(deps(db), body({ expectedTotalMxnCents: 199999 }), 'es-MX')
    ).resolves.toEqual(refused(409, 'PRICE_CHANGED'));
    expect(
      sql.some((s) => s.startsWith('UPDATE products SET reserved_stock'))
    ).toBe(false);
    expect(state().products[0].reserved).toBe(0);
  });

  it('D ⊤ P ⊤ I ⊥: the last unit taken in between → 409 INSUFFICIENT_STOCK, nothing kept', async () => {
    // Two lines: the tent reserves, then the lamp's only unit goes to another buyer first.
    const { db, state } = memoryDb(
      {},
      {
        beforeReserve: (s, outside) => {
          if (s.products[0].reserved === 1)
            outside((x) => {
              x.products[1].reserved = 1;
            });
        },
      }
    );
    const twoLines = body({
      items: [
        { sku: 'TENT', quantity: 1 },
        { sku: 'LAMP', quantity: 1 },
      ],
      expectedTotalMxnCents: 235000,
    });
    await expect(createCheckout(deps(db), twoLines, 'es-MX')).resolves.toEqual(
      refused(409, 'INSUFFICIENT_STOCK')
    );
    // Rolled back: the tent's reservation and the order are gone; the other buyer keeps the lamp.
    expect(state().products.map((p) => p.reserved)).toEqual([0, 1]);
    expect(state().orders).toEqual([]);
  });

  it('D ⊤ P ⊤ I ⊤: 201 session, order PENDING, stock reserved, personal data sealed', async () => {
    const { db, state } = memoryDb();
    const stripe = processor();
    const outcome = await createCheckout(
      deps(db, { processors: { STRIPE: stripe.port } }),
      body(),
      'es-MX'
    );
    if (!outcome.ok) throw new Error('expected a session');
    expect(outcome.session).toEqual({
      orderNumber: expect.stringMatching(/^YEK-2026-[0-9A-Z]{8}$/),
      accessToken: expect.stringMatching(/^[\w-]{43}$/),
      redirectUrl: 'https://checkout.stripe.com/c/pay/x',
      expiresAt: new Date(NOW.getTime() + 60 * MIN).toISOString(),
      totalMxnCents: 200000,
    });
    const { orderNumber, accessToken } = outcome.session;
    const [order] = state().orders;
    const p = order.params as unknown[];
    expect(order.status).toBe(1);
    expect(order.reference).toBe(`ref_${orderNumber}`);
    // Amounts as quoted: items 185 000 (159 483 + 25 517), shipping 15 000 (12 931 + 2 069).
    expect(p.slice(0, 9)).toEqual([
      orderNumber,
      1,
      159483,
      25517,
      185000,
      12931,
      2069,
      15000,
      200000,
    ]);
    expect(
      openPii(PII_KEY, orderNumber, 'customer_email', p[10] as Buffer)
    ).toBe('Ana@Example.com');
    expect(
      JSON.parse(
        openPii(PII_KEY, orderNumber, 'shipping_address', p[12] as Buffer)
      )
    ).toMatchObject({
      stateCode: 'ZAC',
      postalCode: '98612',
    });
    expect((p[14] as Buffer).equals(tokenHash(TOKEN_PEPPER, accessToken))).toBe(
      true
    );
    expect(p.slice(15, 19)).toEqual([
      NOW,
      new Date(NOW.getTime() + 60 * MIN),
      1,
      'ZAC',
    ]);
    // No plain personal data anywhere in the row.
    expect(JSON.stringify(p)).not.toMatch(/Ana|Barones|4929421780/);
    expect(state().items.map((i) => i.params)).toEqual([
      [1, 1, 'TENT', 1, 185000, 159483, 25517, 185000],
    ]);
    expect(state().products[0].reserved).toBe(1);
    expect(stripe.requests).toEqual([
      {
        orderNumber,
        method: 'CARD',
        totalMxnCents: 200000,
        description: `Yēkora · ${orderNumber}`,
        expiresAt: new Date(NOW.getTime() + 60 * MIN),
        now: NOW,
        successUrl: 'https://yekora.mx/checkout/exito/',
        cancelUrl: 'https://yekora.mx/checkout/cancelado/',
        notificationUrl: 'https://apiv1.yekora.mx/v1/webhooks/stripe',
      },
    ]);
  });

  it('SPEI goes to Mercado Pago with its 24 h hold, English return pages, and live orders are not tests', async () => {
    const { db, state } = memoryDb();
    const mp = processor();
    const outcome = await createCheckout(
      deps(db, {
        processors: { MERCADO_PAGO: mp.port },
        payments: payments({ mode: 'live' }),
      }),
      body({ method: 'SPEI' }),
      'en'
    );
    expect(outcome.ok).toBe(true);
    expect(mp.requests[0]).toMatchObject({
      method: 'SPEI',
      expiresAt: new Date(NOW.getTime() + 1440 * MIN),
      successUrl: 'https://yekora.mx/en/checkout/success/',
      cancelUrl: 'https://yekora.mx/en/checkout/cancel/',
      notificationUrl: 'https://apiv1.yekora.mx/v1/webhooks/mercadopago',
    });
    expect((state().orders[0].params as unknown[])[17]).toBe(0);
  });

  it('a retired method is 503 SERVICE_UNAVAILABLE without reserving', async () => {
    const { db, state } = memoryDb();
    await expect(
      createCheckout(
        deps(db),
        body({ method: 'MERCADO_PAGO_BALANCE' }),
        'es-MX'
      )
    ).resolves.toEqual(refused(503, 'SERVICE_UNAVAILABLE'));
    expect(state().products[0].reserved).toBe(0);
  });

  it('a processor failure cancels the order and gives the stock back (503)', async () => {
    const { db, state } = memoryDb();
    const outcome = await createCheckout(
      deps(db, { processors: { STRIPE: processor(true).port } }),
      body(),
      'es-MX'
    );
    expect(outcome).toEqual(refused(503, 'SERVICE_UNAVAILABLE'));
    expect(state().orders[0].status).toBe(4);
    expect(state().products[0].reserved).toBe(0);
  });

  it('does not touch an order that left PENDING while the processor was failing', async () => {
    const { db, state } = memoryDb();
    const stripe: PaymentProcessorPort = {
      ...processor().port,
      async createSession() {
        state().orders[0].status = 3; // expired meanwhile by another request
        throw new Error('timeout');
      },
    };
    await createCheckout(
      deps(db, { processors: { STRIPE: stripe } }),
      body(),
      'es-MX'
    );
    expect(state().orders[0].status).toBe(3);
    expect(state().products[0].reserved).toBe(1); // released by the expiry, not twice
  });

  it('lets a database failure surface instead of answering a code', async () => {
    const { db } = memoryDb({}, { failInsert: true });
    await expect(createCheckout(deps(db), body(), 'es-MX')).rejects.toThrow(
      'connection lost'
    );
  });
});

describe('lazy expiry (no cron, no public endpoint)', () => {
  it('releases overdue reservations first, so their units can be bought again', async () => {
    const { db, state } = memoryDb();
    state().products[1].reserved = 1; // the lamp's only unit, held by an overdue order
    state().orders.push({
      id: 1,
      params: [],
      status: 1,
      expiresAt: new Date(NOW.getTime() - 1),
      reference: null,
    });
    state().items.push({ orderId: 1, productId: 2, quantity: 1, params: [] });
    const lamp = body({
      items: [{ sku: 'LAMP', quantity: 1 }],
      expectedTotalMxnCents: 50000,
    });
    const outcome = await createCheckout(deps(db), lamp, 'es-MX');
    expect(outcome.ok).toBe(true);
    expect(state().orders[0].status).toBe(3);
    expect(state().products[1].reserved).toBe(1); // now held by the new order
  });

  it('expires only pending orders whose time is up, and reports how many', async () => {
    const { db, state } = memoryDb();
    state().orders.push(
      {
        id: 1,
        params: [],
        status: 1,
        expiresAt: new Date(NOW.getTime() + 1),
        reference: null,
      },
      {
        id: 2,
        params: [],
        status: 2,
        expiresAt: new Date(NOW.getTime() - 1),
        reference: null,
      }
    );
    await expect(expireOverdueOrders(db, NOW)).resolves.toBe(0);
    expect(state().orders.map((o) => o.status)).toEqual([1, 2]);
  });
});
