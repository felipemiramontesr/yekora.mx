/**
 * FC 069 F1 evidence of the refund table (T1.2, T1.3, T2.3): which statuses a whole refund
 * admits, and what applying one writes.
 */
import { describe, expect, it } from 'vitest';
import type { TxQuery } from './db';
import { applyRefund, decideRefund } from './refundFsm';

describe('decideRefund: one row per status of the table', () => {
  it.each([
    [2, 'ORDER_REFUNDED_RESTOCK'],
    [7, 'ORDER_REFUNDED_RESTOCK'],
    [8, 'ORDER_REFUNDED_NO_RESTOCK'],
    [9, 'ORDER_REFUNDED_NO_RESTOCK'],
    [5, 'IDEMPOTENT_IGNORED'],
    [1, 'REFUND_STATUS_CONFLICT_ANOMALY'],
    [3, 'REFUND_STATUS_CONFLICT_ANOMALY'],
    [4, 'REFUND_STATUS_CONFLICT_ANOMALY'],
    [6, 'REFUND_STATUS_CONFLICT_ANOMALY'],
  ])('status %i → %s', (status, outcome) => {
    expect(decideRefund(status)).toBe(outcome);
  });
});

describe('applyRefund', () => {
  function recording() {
    const sql: { text: string; params: readonly unknown[] }[] = [];
    const tx: TxQuery = {
      async query<R>(text: string, params: readonly unknown[] = []) {
        sql.push({ text, params });
        return [] as R[];
      },
    };
    return { tx, sql };
  }

  it('with the stock still in the warehouse: status, units back, notice and audit', async () => {
    const { tx, sql } = recording();
    await applyRefund(tx, 7, 'YEK-2026-AB12CD34', 'ORDER_REFUNDED_RESTOCK');
    expect(
      sql.map(({ text }) => text.split(' ').slice(0, 2).join(' '))
    ).toEqual([
      'UPDATE orders',
      'UPDATE products',
      'INSERT INTO',
      'INSERT INTO',
    ]);
    expect(sql[0].params).toEqual([5, 7]);
    expect(sql[1].text).toContain('p.stock = p.stock + i.quantity');
    expect(sql[3].params[0]).toBeNull();
    expect(sql[3].params[1]).toBe('ORDER_REFUNDED');
    expect(sql[3].params[3]).toBe('YEK-2026-AB12CD34');
    expect(sql[3].params[5]).toContain('"restocked":true');
  });

  it('with the units gone: no stock statement at all', async () => {
    const { tx, sql } = recording();
    await applyRefund(tx, 7, 'YEK-2026-AB12CD34', 'ORDER_REFUNDED_NO_RESTOCK');
    expect(sql.some(({ text }) => text.includes('UPDATE products'))).toBe(
      false
    );
    expect(sql.at(-1)?.params[5]).toContain('"restocked":false');
  });
});
