/**
 * FC 068 F1 evidence of the fulfillment machine (T1.1 C, T1.2, T2.1, T2.2): each step moves a paid
 * order forward from the statuses it admits and from no other, stores the parcel and the times,
 * queues its notice in the same transaction, and a refused step writes nothing at all.
 *
 * The database is an in-memory table of handlers keyed by the start of each statement.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ShipRequest } from '../../../../lib/account/fulfillmentTypes';
import type { TxQuery } from './db';
import { type FulfillmentStep, transitionOrder } from './ordersFsm';

const NOW = new Date('2026-11-22T18:00:00Z');
const ACTOR = {
  userId: 'a0000000-0000-4000-8000-000000000001',
  ip: '203.0.113.7',
};
const NUMBER = 'YEK-2026-AB12CD34';

const CODES: Record<number, string> = {
  1: 'PENDING_PAYMENT',
  2: 'PAID',
  3: 'EXPIRED',
  4: 'CANCELLED',
  5: 'REFUNDED',
  6: 'NEEDS_REVIEW',
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
  writes: 0,
};

const tx: TxQuery = {
  async query<R>(text: string, params: readonly unknown[] = []) {
    const order = store.order;
    if (text.startsWith('SELECT id, status_id FROM orders')) {
      return (
        order && params[0] === NUMBER
          ? [{ id: order.id, status_id: order.status_id }]
          : []
      ) as R[];
    }
    if (text.startsWith('UPDATE orders SET status_id = ?, carrier = ?')) {
      store.writes += 1;
      const [status, carrier, number, url, at] = params as [
        number,
        string,
        string,
        string | null,
        Date,
      ];
      Object.assign(order as Row, {
        status_id: status,
        carrier,
        tracking_number: number,
        tracking_url: url,
        shipped_at: at,
      });
      return [] as R[];
    }
    if (text.startsWith('UPDATE orders SET status_id = ?, delivered_at = ?')) {
      store.writes += 1;
      Object.assign(order as Row, {
        status_id: params[0],
        delivered_at: params[1],
      });
      return [] as R[];
    }
    if (text.startsWith('UPDATE orders SET status_id = ? WHERE id = ?')) {
      store.writes += 1;
      (order as Row).status_id = params[0] as number;
      return [] as R[];
    }
    if (text.startsWith('INSERT INTO outbox_events')) {
      store.outbox.push({
        type: params[0] as string,
        payload: JSON.parse(params[1] as string),
      });
      return [] as R[];
    }
    if (text.startsWith('SELECT s.code AS status')) {
      const row = order as Row;
      return [{ ...row, status: CODES[row.status_id] }] as R[];
    }
    if (text.startsWith('INSERT INTO audit_log')) {
      store.audit.push([...params]);
      return [] as R[];
    }
    throw new Error(`unexpected SQL: ${text}`);
  },
};

const SHIPMENT = {
  carrier: 'DHL',
  trackingNumber: '1234567890',
  trackingUrl: 'https://www.dhl.com/track?id=1234567890',
};

const run = (
  step: FulfillmentStep,
  parcel: ShipRequest | null = step === 'ship' ? SHIPMENT : null
) => transitionOrder(tx, step, NUMBER, parcel, ACTOR, NOW);

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
  store.writes = 0;
});

describe('the steps that apply (T1.1 C ⊤, T2.1)', () => {
  it('prepare: PAID → PREPARING, queues ORDER_PREPARED with the order id only (T2.2)', async () => {
    const result = await run('prepare');
    expect(result).toEqual({
      orderNumber: NUMBER,
      fulfillment: 'PREPARING',
      carrier: null,
      trackingNumber: null,
      trackingUrl: null,
      shippedAt: null,
      deliveredAt: null,
    });
    expect(store.order?.status_id).toBe(7);
    expect(store.outbox).toEqual([
      { type: 'ORDER_PREPARED', payload: { orderId: 7 } },
    ]);
  });

  it.each([
    ['PAID', 2],
    ['PREPARING', 7],
  ])(
    'ship from %s: SHIPPED with the carrier, the guide and the time it left, queues ORDER_SHIPPED',
    async (_origin, status) => {
      store.order!.status_id = status;
      const result = await run('ship');
      expect(result).toEqual({
        orderNumber: NUMBER,
        fulfillment: 'SHIPPED',
        carrier: 'DHL',
        trackingNumber: '1234567890',
        trackingUrl: 'https://www.dhl.com/track?id=1234567890',
        shippedAt: NOW.toISOString(),
        deliveredAt: null,
      });
      expect(store.outbox).toEqual([
        { type: 'ORDER_SHIPPED', payload: { orderId: 7 } },
      ]);
    }
  );

  it('ship without a link keeps the link empty', async () => {
    const result = await run('ship', {
      carrier: 'Estafeta',
      trackingNumber: 'EF1',
    });
    expect(result).toMatchObject({ fulfillment: 'SHIPPED', trackingUrl: null });
  });

  it('deliver: SHIPPED → DELIVERED with the time it arrived, and tells nobody', async () => {
    store.order!.status_id = 8;
    store.order!.carrier = 'DHL';
    store.order!.tracking_number = '1';
    store.order!.shipped_at = new Date('2026-11-21T10:00:00Z');
    const result = await run('deliver');
    expect(result).toMatchObject({
      fulfillment: 'DELIVERED',
      carrier: 'DHL',
      shippedAt: '2026-11-21T10:00:00.000Z',
      deliveredAt: NOW.toISOString(),
    });
    expect(store.outbox).toEqual([]);
  });

  it('walks the whole way and leaves one audit entry per step, without the guide or the link (T2.3 of FC 061 style)', async () => {
    await run('prepare');
    await run('ship');
    await run('deliver');
    expect(store.order?.status_id).toBe(9);
    expect(store.outbox.map((event) => event.type)).toEqual([
      'ORDER_PREPARED',
      'ORDER_SHIPPED',
    ]);
    expect(store.audit.map((entry) => entry[1])).toEqual([
      'ORDER_PREPARED',
      'ORDER_SHIPPED',
      'ORDER_DELIVERED',
    ]);
    expect(JSON.stringify(store.audit)).not.toContain('1234567890');
    expect(JSON.stringify(store.audit)).not.toContain('dhl.com');
  });
});

describe('the steps that do not apply (T1.1 C ⊥, T2.1): 409 and nothing written', () => {
  const ADMITTED: Record<FulfillmentStep, number[]> = {
    prepare: [2],
    ship: [2, 7],
    deliver: [8],
  };
  const cases = (['prepare', 'ship', 'deliver'] as const).flatMap((step) =>
    [1, 2, 3, 4, 5, 6, 7, 8, 9]
      .filter((status) => !ADMITTED[step].includes(status))
      .map((status) => [step, CODES[status], status] as const)
  );

  it.each(cases)('%s from %s is refused', async (step, _code, status) => {
    store.order!.status_id = status;
    await expect(run(step)).resolves.toBe('ORDER_STATUS_CONFLICT');
    expect(store.order?.status_id).toBe(status);
    expect(store.writes).toBe(0);
    expect(store.outbox).toEqual([]);
    expect(store.audit).toEqual([]);
  });

  it('never jumps from PAID straight to DELIVERED', async () => {
    await expect(run('deliver')).resolves.toBe('ORDER_STATUS_CONFLICT');
    expect(store.order?.status_id).toBe(2);
  });

  it('a repeated step finds the order already moved and queues nothing more (T1.2, T2.2)', async () => {
    await run('prepare');
    await expect(run('prepare')).resolves.toBe('ORDER_STATUS_CONFLICT');
    expect(store.outbox).toHaveLength(1);
  });

  it('an order that does not exist is ORDER_NOT_FOUND', async () => {
    store.order = null;
    await expect(run('prepare')).resolves.toBe('ORDER_NOT_FOUND');
    expect(store.outbox).toEqual([]);
  });
});
