import fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { decryptPii } from '../services/checkoutCrypto';
import type { Db, Transactional } from '../services/db';
import { posReceipt } from '../services/posReceipt';
import { registerPosRoutes } from './adminPos';

const NOW = new Date('2026-11-27T18:00:00Z');
const CASHIER = 'a0000000-0000-4000-8000-000000000001';
const SECRETS = {
  piiKey: Buffer.alloc(32, 9),
  emailPepper: 'e'.repeat(32),
  tokenPepper: 't'.repeat(32),
};

const PRODUCTS = [
  {
    id: 3,
    sku: 'PACK',
    name_es: 'Mochila de 30 litros',
    name_en: 'Backpack',
    price_mxn_cents: '116000',
    stock: 5,
    reserved_stock: 2,
    allows_return: 1,
  },
  {
    id: 7,
    sku: 'ROPE',
    name_es: 'Cuerda',
    name_en: 'Rope',
    price_mxn_cents: '5800',
    stock: 1,
    reserved_stock: 0,
    allows_return: 0,
  },
];

function counter(options: { shift?: boolean } = {}) {
  const state = {
    writes: [] as { sql: string; params: unknown[] }[],
    products: PRODUCTS.map((p) => ({ ...p })),
    order: null as unknown[] | null,
  };
  async function query(sql: string, p: unknown[] = []): Promise<unknown> {
    if (sql.startsWith("SELECT id FROM pos_shifts WHERE status = 'OPEN'")) {
      return options.shift === false ? [] : [{ id: 4 }];
    }
    if (sql.startsWith('SELECT id, sku, price_mxn_cents')) {
      return state.products.filter((x) => (p[0] as string[]).includes(x.sku));
    }
    if (sql.startsWith('SELECT sku, name_es, name_en')) {
      return [
        {
          sku: 'PACK',
          name_es: 'Mochila',
          name_en: 'Backpack',
          price_mxn_cents: '116000',
          available: 3,
        },
      ];
    }
    state.writes.push({ sql, params: p });
    if (sql.startsWith('INSERT INTO orders')) {
      state.order = p;
      return { insertId: 11 };
    }
    return [];
  }
  const db = {
    query,
    ping: async () => undefined,
    close: async () => undefined,
    transaction<T>(work: (tx: Db) => Promise<T>) {
      return work(this as unknown as Db);
    },
  } as unknown as Db & Transactional;
  return { state, db };
}

let keys = 0;
async function setup(options: { shift?: boolean; checkout?: boolean } = {}) {
  const world = counter(options);
  const app = fastify();
  app.decorateRequest('user', null);
  app.decorateRequest('outboxQueued', false);
  app.addHook('preHandler', async (request) => {
    request.user = { userId: CASHIER, permissions: ['pos:sell'] } as never;
  });
  registerPosRoutes(app, {
    db: world.db,
    now: () => NOW,
    checkout: options.checkout === false ? null : SECRETS,
  });
  await app.ready();
  const sell = (payload: object) => {
    keys += 1;
    return app.inject({
      method: 'POST',
      url: '/v1/admin/pos/checkout',
      payload,
      headers: { 'idempotency-key': `s-${keys}` },
    });
  };
  const wrote = (start: string) =>
    world.state.writes.filter((w) => w.sql.startsWith(start));
  return { ...world, app, sell, wrote };
}

const cash = (tenderedMxnCents: number, quantity = 1) => ({
  items: [{ sku: 'PACK', quantity }],
  payment: { method: 'POS_CASH', tenderedMxnCents },
});
const card = (over: Record<string, unknown> = {}) => ({
  items: [{ sku: 'PACK', quantity: 1 }],
  payment: {
    method: 'POS_CARD_MANUAL',
    confirmedAmountMxnCents: 116000,
    terminalAuthCode: 'A1B2C3',
    cardLastFour: '4242',
    cardBrand: 'Visa',
    voucherFolio: 'F-77',
    ...over,
  },
});

describe('the counter (FC 076 F2)', { timeout: 30_000 }, () => {
  it('lists the products with what is left after online reservations', async () => {
    const { app } = await setup();
    const all = await app.inject('/v1/admin/pos/products');
    expect(all.json().items[0]).toMatchObject({ sku: 'PACK', available: 3 });
    await app.inject('/v1/admin/pos/products?q=mo%25');
    const bad = await app.inject('/v1/admin/pos/products?q=');
    expect(bad.statusCode).toBe(400);
  });

  it('sells for cash: delivered at once, server prices and VAT, change, stock down, sealed buyer', async () => {
    const { sell, state, wrote } = await setup();
    const done = await sell({
      ...cash(300000, 2),
      customerEmail: 'ana@example.test',
    });
    expect(done.statusCode).toBe(201);
    const body = done.json();
    expect(body).toMatchObject({
      method: 'POS_CASH',
      totalMxnCents: 232000,
      changeMxnCents: 68000,
    });
    expect(body.orderNumber).toMatch(/^YEK-2026-[0-9A-Z]{8}$/);
    const order = state.order!;
    expect(order[1]).toBe(5);
    expect(order[2]).toBe(`pos:${body.orderNumber}`);
    expect([order[4], order[5], order[6], order[7]]).toEqual([
      200000, 32000, 232000, 232000,
    ]);
    expect(
      decryptPii(
        SECRETS.piiKey,
        body.orderNumber,
        'customer_email',
        order[9] as Buffer
      )
    ).toBe('ana@example.test');
    expect(order[15]).toEqual(new Date('2026-11-27T19:00:00Z'));
    expect(wrote('UPDATE products SET stock')[0].params).toEqual([2, 3]);
    expect(wrote('INSERT INTO outbox_events')[0].params[0]).toBe(
      'POS_RECEIPT_EMAIL'
    );
    expect(wrote('INSERT INTO order_items')[0].params[0]).toEqual([
      [11, 3, 'PACK', 2, 116000, 200000, 32000, 232000, 1],
    ]);
  });

  it('sells on the terminal, keeping only the voucher data, with no mail unless asked', async () => {
    const { sell, state, wrote } = await setup();
    const done = await sell(card());
    expect(done.statusCode).toBe(201);
    expect(done.json()).toMatchObject({
      method: 'POS_CARD_MANUAL',
      changeMxnCents: 0,
    });
    expect(state.order!.slice(-4)).toEqual(['A1B2C3', '4242', 'Visa', 'F-77']);
    expect(wrote('INSERT INTO outbox_events')).toHaveLength(0);
  });

  it.each([
    [
      'not enough stock',
      { items: [{ sku: 'ROPE', quantity: 2 }] },
      'INSUFFICIENT_STOCK_REJECT',
    ],
    [
      'reserved online',
      { items: [{ sku: 'PACK', quantity: 4 }] },
      'STOCK_RESERVED_ONLINE_REJECT',
    ],
    [
      'an unknown product',
      { items: [{ sku: 'NADA', quantity: 1 }] },
      'POS_PRODUCT_UNKNOWN',
    ],
  ])('refuses %s without writing', async (_case, change, code) => {
    const { sell, state } = await setup();
    const refused = await sell({ ...cash(10_000_000), ...change });
    expect(refused.json()).toMatchObject({ detail: code });
    expect(state.order).toBeNull();
  });

  it('refuses a sale without an open shift', async () => {
    const { sell } = await setup({ shift: false });
    const refused = await sell(cash(200000));
    expect(refused.json()).toMatchObject({ detail: 'POS_SHIFT_CLOSED_REJECT' });
  });

  it.each([
    [
      'a method of the web',
      { ...cash(1), payment: { method: 'CARD' } },
      'INVALID_POS_METHOD_REJECT',
    ],
    ['cash below the total', cash(1000), 'INSUFFICIENT_TENDERED_REJECT'],
    [
      'cash with no amount',
      { ...cash(1), payment: { method: 'POS_CASH' } },
      'INSUFFICIENT_TENDERED_REJECT',
    ],
    [
      'another amount on the terminal',
      card({ confirmedAmountMxnCents: 100 }),
      'TERMINAL_AMOUNT_MISMATCH_REJECT',
    ],
    [
      'three digits',
      card({ cardLastFour: '424' }),
      'INVALID_VOUCHER_DATA_REJECT',
    ],
    ['no folio', card({ voucherFolio: '' }), 'INVALID_VOUCHER_DATA_REJECT'],
    ['no brand', card({ cardBrand: undefined }), 'INVALID_VOUCHER_DATA_REJECT'],
    [
      'no authorization',
      card({ terminalAuthCode: undefined }),
      'INVALID_VOUCHER_DATA_REJECT',
    ],
    [
      'a card number as the authorization (T0.1)',
      card({ terminalAuthCode: '4111111111111111' }),
      'INVALID_VOUCHER_DATA_REJECT',
    ],
    [
      'a card number in the folio (T0.1)',
      card({ voucherFolio: '4111 1111 1111 1111' }),
      'INVALID_VOUCHER_DATA_REJECT',
    ],
    [
      'nothing but the amount on the terminal',
      {
        ...card(),
        payment: { method: 'POS_CARD_MANUAL', confirmedAmountMxnCents: 116000 },
      },
      'INVALID_VOUCHER_DATA_REJECT',
    ],
  ])('refuses %s', async (_case, payload, code) => {
    const { sell, state } = await setup();
    const refused = await sell(payload);
    expect(refused.json()).toMatchObject({ detail: code });
    expect(state.order).toBeNull();
  });

  it('refuses a body that repeats a product, and answers 503 without checkout secrets', async () => {
    const { sell } = await setup();
    const twice = await sell({
      ...cash(1),
      items: [
        { sku: 'PACK', quantity: 1 },
        { sku: 'PACK', quantity: 1 },
      ],
    });
    expect(twice.json()).toMatchObject({ detail: 'INVALID_REQUEST' });
    const without = await setup({ checkout: false });
    const down = await without.sell(cash(200000));
    expect(down.statusCode).toBe(503);
  });
});

describe('the thermal receipt (FC 076 F3)', () => {
  const order = {
    id: 11,
    paid_at: NOW,
    items_base_mxn_cents: '100000',
    items_tax_mxn_cents: '16000',
    total_mxn_cents: '116000',
    pos_tendered_mxn_cents: '120000',
    pos_change_mxn_cents: '4000',
    pos_terminal_auth_code: null,
    pos_terminal_last_four: null,
    pos_terminal_brand: null,
    pos_terminal_voucher_folio: null,
  };
  const items = [
    {
      sku: 'PACK',
      name_es: 'Mochila de 30 litros con un nombre muy largo de verdad',
      quantity: 1,
      line_total_mxn_cents: '116000',
    },
  ];
  const db = (row: object | null) => {
    const orders = row === null ? [] : [row];
    return {
      query: async (sql: string) =>
        sql.startsWith('SELECT id, paid_at') ? orders : items,
    } as unknown as Db;
  };

  it('prints a cash sale within the width of each paper', async () => {
    for (const [mm, columns] of [
      [80, 42],
      [58, 32],
    ] as const) {
      const receipt = await posReceipt(db(order), 'YEK-2026-AAAA0001', mm);
      expect(receipt?.widthMm).toBe(mm);
      expect(receipt?.lines.every((line) => line.length <= columns)).toBe(true);
      const text = receipt!.lines.join('\n');
      expect(text).toContain('$1160.00');
      expect(text).toContain('Efectivo recibido');
      expect(text).toContain('$40.00');
      expect(text).toContain('No es comprobante fiscal');
    }
  });

  it('prints a terminal sale with only the last four digits', async () => {
    const receipt = await posReceipt(
      db({
        ...order,
        pos_terminal_auth_code: 'A1B2',
        pos_terminal_last_four: '4242',
        pos_terminal_brand: 'Visa',
        pos_terminal_voucher_folio: 'F-77',
      }),
      'YEK-2026-AAAA0001',
      80
    );
    const text = receipt!.lines.join('\n');
    expect(text).toContain('**** 4242');
    expect(text).toContain('Autorizacion A1B2');
    expect(text).not.toContain('Cambio');
  });

  it('answers nothing for an order that is not of the counter, and the route says 404', async () => {
    await expect(
      posReceipt(db(null), 'YEK-2026-AAAA0001', 80)
    ).resolves.toBeNull();
    const { app } = await setup();
    const missing = await app.inject(
      '/v1/admin/pos/orders/YEK-2026-AAAA0001/receipt'
    );
    expect(missing.statusCode).toBe(404);
    const narrow = await app.inject(
      '/v1/admin/pos/orders/YEK-2026-AAAA0001/receipt?width=58'
    );
    expect(narrow.statusCode).toBe(404);
    const bad = await app.inject(
      '/v1/admin/pos/orders/YEK-2026-AAAA0001/receipt?width=70'
    );
    expect(bad.statusCode).toBe(400);
  });
});
