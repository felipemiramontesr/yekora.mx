import { describe, expect, it } from 'vitest';
import type { TxQuery } from '../apps/api/src/services/db';
import {
  judgeBatch,
  type PurgeCandidate,
  purgeSandboxOrders,
} from './lib/sandboxPurge';

/** A settled test order with no live event: the only kind the purge accepts. */
function candidate(
  id: number,
  overrides: Partial<PurgeCandidate> = {}
): PurgeCandidate {
  return {
    id,
    order_number: `YEK-2026-0000000${id}`,
    status: 'PAID',
    is_test: 1,
    live_events: 0,
    ...overrides,
  };
}

/** Records every statement and answers the SELECTs from the given rows. */
function fakeDb(candidates: PurgeCandidate[]) {
  const statements: { sql: string; params: readonly unknown[] }[] = [];
  const tx: TxQuery = {
    query<Row>(sql: string, params: readonly unknown[] = []) {
      statements.push({ sql, params });
      if (sql.includes('live_events'))
        return Promise.resolve(candidates as Row[]);
      if (sql.includes('AS sold_units'))
        return Promise.resolve([{ items: '5', sold_units: '3' }] as Row[]);
      if (sql.includes('AS events'))
        return Promise.resolve([{ events: '4' }] as Row[]);
      return Promise.resolve([] as Row[]);
    },
  };
  return {
    statements,
    deletes: () => statements.filter(({ sql }) => sql.startsWith('DELETE')),
    db: { transaction: <T>(work: (q: TxQuery) => Promise<T>) => work(tx) },
  };
}

describe('judgeBatch (FC 027 T2.1: the batch is judged as a whole)', () => {
  it('accepts a batch where every order is a settled test order', () => {
    const batch = [
      candidate(1),
      candidate(2, { status: 'EXPIRED' }),
      candidate(3, { status: 'CANCELLED' }),
      candidate(4, { status: 'REFUNDED' }),
    ];
    expect(judgeBatch(batch, null)).toEqual({
      ok: true,
      orderIds: [1, 2, 3, 4],
    });
  });

  it('refuses a mixed batch: one live order aborts all of it', () => {
    const batch = [candidate(1), candidate(2, { is_test: 0 }), candidate(3)];
    expect(judgeBatch(batch, null)).toEqual({
      ok: false,
      code: 'LIVE_ORDER_IN_BATCH',
      orderNumbers: ['YEK-2026-00000002'],
    });
  });

  it('refuses a test order that carries a live payment event', () => {
    expect(judgeBatch([candidate(1, { live_events: 1 })], null)).toMatchObject({
      ok: false,
      code: 'LIVE_EVENT_IN_BATCH',
    });
  });

  it('refuses orders whose stock is not settled (pending reservation or under review)', () => {
    const batch = [
      candidate(1, { status: 'PENDING_PAYMENT' }),
      candidate(2, { status: 'NEEDS_REVIEW' }),
    ];
    expect(judgeBatch(batch, null)).toEqual({
      ok: false,
      code: 'UNSETTLED_ORDER_IN_BATCH',
      orderNumbers: ['YEK-2026-00000001', 'YEK-2026-00000002'],
    });
  });

  it('refuses a requested order number that was not found', () => {
    expect(
      judgeBatch([candidate(1)], ['YEK-2026-00000001', 'YEK-2026-NOTFOUND'])
    ).toEqual({
      ok: false,
      code: 'UNKNOWN_ORDER',
      orderNumbers: ['YEK-2026-NOTFOUND'],
    });
  });

  it('reports an empty batch instead of deleting nothing silently', () => {
    expect(judgeBatch([], null)).toEqual({
      ok: false,
      code: 'NOTHING_TO_PURGE',
      orderNumbers: [],
    });
  });
});

describe('purgeSandboxOrders (FC 027 T2.1)', () => {
  it('locks every test order, then deletes children first: events, lines, orders', async () => {
    const fake = fakeDb([candidate(1), candidate(2)]);
    const outcome = await purgeSandboxOrders(
      fake.db,
      { kind: 'all-test' },
      { dryRun: false }
    );
    expect(outcome).toEqual({
      ok: true,
      dryRun: false,
      orders: 2,
      items: 5,
      events: 4,
      soldUnits: 3,
    });
    expect(fake.statements[0].sql).toMatch(/WHERE o\.is_test = 1 FOR UPDATE$/);
    expect(fake.deletes()).toEqual([
      {
        sql: 'DELETE FROM payment_events WHERE order_id IN (?)',
        params: [[1, 2]],
      },
      {
        sql: 'DELETE FROM order_items WHERE order_id IN (?)',
        params: [[1, 2]],
      },
      {
        sql: 'DELETE FROM orders WHERE id IN (?) AND is_test = 1',
        params: [[1, 2]],
      },
    ]);
  });

  it('counts only the units of paid or refunded orders as sold', async () => {
    const fake = fakeDb([candidate(1)]);
    await purgeSandboxOrders(fake.db, { kind: 'all-test' }, { dryRun: true });
    const count = fake.statements.find(({ sql }) => sql.includes('sold_units'));
    expect(count?.params).toEqual([['PAID', 'REFUNDED'], [1]]);
  });

  it('locks exactly the requested order numbers', async () => {
    const fake = fakeDb([candidate(7)]);
    await purgeSandboxOrders(
      fake.db,
      { kind: 'orders', orderNumbers: ['YEK-2026-00000007'] },
      { dryRun: false }
    );
    expect(fake.statements[0]).toMatchObject({
      params: [['YEK-2026-00000007']],
    });
    expect(fake.statements[0].sql).toMatch(
      /WHERE o\.order_number IN \(\?\) FOR UPDATE$/
    );
    expect(fake.deletes()).toHaveLength(3);
  });

  it('a dry run counts what would go and deletes nothing', async () => {
    const fake = fakeDb([candidate(1)]);
    const outcome = await purgeSandboxOrders(
      fake.db,
      { kind: 'all-test' },
      { dryRun: true }
    );
    expect(outcome).toMatchObject({ ok: true, dryRun: true, orders: 1 });
    expect(fake.deletes()).toEqual([]);
  });

  it('a mixed batch aborts with zero DELETE statements (DeletesCount = 0)', async () => {
    const fake = fakeDb([candidate(1), candidate(2, { is_test: 0 })]);
    const outcome = await purgeSandboxOrders(
      fake.db,
      {
        kind: 'orders',
        orderNumbers: ['YEK-2026-00000001', 'YEK-2026-00000002'],
      },
      { dryRun: false }
    );
    expect(outcome).toEqual({
      ok: false,
      dryRun: false,
      code: 'LIVE_ORDER_IN_BATCH',
      orderNumbers: ['YEK-2026-00000002'],
    });
    expect(fake.deletes()).toEqual([]);
  });

  it('an empty list of order numbers touches nothing', async () => {
    const fake = fakeDb([]);
    const outcome = await purgeSandboxOrders(
      fake.db,
      { kind: 'orders', orderNumbers: [] },
      { dryRun: false }
    );
    expect(outcome).toMatchObject({ ok: false, code: 'NOTHING_TO_PURGE' });
    expect(fake.statements).toEqual([]);
  });
});
