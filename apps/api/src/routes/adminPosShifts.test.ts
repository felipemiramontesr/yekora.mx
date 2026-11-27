import fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { Db, Transactional } from '../services/db';
import {
  decidePayment,
  decideSaleStock,
  decideShiftClose,
  decideWithdrawal,
} from '../services/posGates';
import { registerPosRoutes } from './adminPos';

const NOW = new Date('2026-11-27T18:00:00Z');
const CASHIER = 'a0000000-0000-4000-8000-000000000001';
const OTHER = 'a0000000-0000-4000-8000-000000000002';

const bools = [true, false];

describe('T1.1 to T1.4 · the pure gates of the point of sale (FC 076)', () => {
  it.each(
    bools.flatMap((stock) =>
      bools.flatMap((unreserved) =>
        bools.map((shiftOpen) => ({ stock, unreserved, shiftOpen }))
      )
    )
  )('T1.1 %o', (i) => {
    let row = 'SALE_PERMITTED';
    if (!i.stock) row = 'INSUFFICIENT_STOCK_REJECT';
    else if (!i.unreserved) row = 'STOCK_RESERVED_ONLINE_REJECT';
    else if (!i.shiftOpen) row = 'POS_SHIFT_CLOSED_REJECT';
    expect(decideSaleStock(i)).toBe(row);
  });

  const five = bools.flatMap((allowed) =>
    bools.flatMap((open) =>
      bools.flatMap((matches) =>
        bools.flatMap((notes) =>
          bools.map((withinLimit) => ({
            allowed,
            open,
            matches,
            notes,
            withinLimit,
          }))
        )
      )
    )
  );
  it('T1.2 has 32 rows', () => expect(five).toHaveLength(32));
  it.each(five)('T1.2 %o', (i) => {
    let row = 'SHIFT_CLOSED_SUCCESS';
    if (!i.allowed) row = 'PERMISSION_DENIED';
    else if (!i.open) row = 'SHIFT_NOT_OPEN_REJECT';
    else if (!i.matches && !i.notes) row = 'MISSING_DIFF_JUSTIFICATION_REJECT';
    else if (!i.matches && !i.withinLimit) {
      row = 'SUPERVISOR_REQUIRED_FOR_LARGE_DIFF';
    }
    expect(decideShiftClose(i)).toBe(row);
  });

  const four = bools.flatMap((a) =>
    bools.flatMap((b) =>
      bools.flatMap((c) => bools.map((d) => [a, b, c, d] as const))
    )
  );
  it.each(four)('T1.4 A=%s S=%s F=%s L=%s', (allowed, open, funds, within) => {
    let row = 'WITHDRAWAL_PERMITTED';
    if (!allowed) row = 'PERMISSION_DENIED';
    else if (!open) row = 'SHIFT_NOT_OPEN_REJECT';
    else if (!funds) row = 'INSUFFICIENT_DRAWER_CASH_REJECT';
    else if (!within) row = 'SUPERVISOR_PERMISSION_REQUIRED';
    expect(
      decideWithdrawal({ allowed, open, funds, withinLimit: within })
    ).toBe(row);
  });

  it.each(four)(
    'T1.3 M=%s E=%s C=%s A=%s',
    (method, tendered, amount, voucher) => {
      let row = 'PAYMENT_VALID_ACCEPTED';
      if (!method) row = 'INVALID_POS_METHOD_REJECT';
      else if (!tendered) row = 'INSUFFICIENT_TENDERED_REJECT';
      else if (!amount) row = 'TERMINAL_AMOUNT_MISMATCH_REJECT';
      else if (!voucher) row = 'INVALID_VOUCHER_DATA_REJECT';
      expect(decidePayment({ method, tendered, amount, voucher })).toBe(row);
    }
  );
});

interface Shift {
  id: number;
  cashier_user_id: string;
  status: string;
  opened_at: Date;
  opening_cash_mxn_cents: number;
  notes: string | null;
}

/** A till in memory: the shifts, the movements and the cash sales of each. */
function till() {
  const state = {
    shifts: [] as Shift[],
    moves: [] as { shift: number; type: string; amount: number }[],
    sales: 0,
    audit: [] as string[],
  };
  const open = () => state.shifts.filter((s) => s.status === 'OPEN');
  async function query(sql: string, p: unknown[] = []): Promise<unknown> {
    if (sql.startsWith('INSERT INTO pos_shifts')) {
      if (open().length > 0) {
        throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
      }
      if (p[1] === 13) throw new Error('the database is down');
      state.shifts.push({
        id: state.shifts.length + 1,
        cashier_user_id: p[0] as string,
        status: 'OPEN',
        opened_at: NOW,
        opening_cash_mxn_cents: p[1] as number,
        notes: null,
      });
      return { affectedRows: 1 };
    }
    if (sql.includes("FROM pos_shifts WHERE status = 'OPEN'")) return open();
    if (sql.includes('FROM pos_shifts WHERE id = ?')) {
      return state.shifts.filter((s) => s.id === p[0]);
    }
    if (sql.startsWith('SELECT COALESCE(SUM(total_mxn_cents)')) {
      return [{ cents: state.sales }];
    }
    if (sql.startsWith('SELECT COALESCE(SUM(CASE')) {
      const total = state.moves
        .filter((m) => m.shift === p[0])
        .reduce((n, m) => n + (m.type === 'IN' ? m.amount : -m.amount), 0);
      return [{ cents: String(total) }];
    }
    if (sql.startsWith('INSERT INTO pos_cash_movements')) {
      state.moves.push({
        shift: p[0] as number,
        type: p[1] as string,
        amount: p[2] as number,
      });
      return { insertId: state.moves.length };
    }
    if (sql.startsWith("UPDATE pos_shifts SET status = 'CLOSED'")) {
      const shift = state.shifts.find((s) => s.id === p[6])!;
      shift.status = 'CLOSED';
      shift.notes = p[5] as string | null;
      return { affectedRows: 1 };
    }
    if (sql.startsWith('INSERT INTO audit_log')) {
      state.audit.push(p[1] as string);
      return [];
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
async function setup(permissions: string[] = ['pos:shift'], userId = CASHIER) {
  const world = till();
  const app = fastify();
  app.decorateRequest('user', null);
  app.addHook('preHandler', async (request) => {
    request.user = {
      userId: request.headers['x-user'] ?? userId,
      permissions:
        (request.headers['x-permissions'] as string)?.split(',') ?? permissions,
    } as never;
  });
  registerPosRoutes(app, {
    db: world.db,
    now: () => NOW,
    checkout: null,
  });
  await app.ready();
  const post = (
    url: string,
    payload: object,
    headers: Record<string, string> = {}
  ) => {
    keys += 1;
    return app.inject({
      method: 'POST',
      url: `/v1/admin/pos/shifts/${url}`,
      payload,
      headers: { 'idempotency-key': `k-${keys}`, ...headers },
    });
  };
  return { ...world, app, post };
}

describe('the till shifts (FC 076 F1)', { timeout: 30_000 }, () => {
  it('opens one shift, refuses a second, and never tells the expected cash (T0.2, T2.3)', async () => {
    const { app, post } = await setup();
    const none = await app.inject('/v1/admin/pos/shifts/current');
    expect(none.json()).toEqual({ shift: null });
    const opened = await post('open', { openingCashMxnCents: 50000 });
    expect(opened.statusCode).toBe(201);
    expect(opened.json()).toEqual({
      id: 1,
      cashierUserId: CASHIER,
      openedAt: NOW.toISOString(),
      openingCashMxnCents: 50000,
    });
    const again = await post('open', { openingCashMxnCents: 1 });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ detail: 'POS_SHIFT_ALREADY_OPEN' });
    const current = await app.inject('/v1/admin/pos/shifts/current');
    expect(current.body).not.toMatch(/expected/i);
  });

  it('lets a database failure surface, and asks for a key and a valid body', async () => {
    const { app, post } = await setup();
    const down = await post('open', { openingCashMxnCents: 13 });
    expect(down.statusCode).toBe(500);
    const noKey = await app.inject({
      method: 'POST',
      url: '/v1/admin/pos/shifts/open',
      payload: { openingCashMxnCents: 1 },
    });
    expect(noKey.json()).toMatchObject({ detail: 'IDEMP_KEY_MISSING' });
    const bad = await post('open', { openingCashMxnCents: -1 });
    expect(bad.json()).toMatchObject({ detail: 'INVALID_REQUEST' });
    const badId = await post('abc/close', { countedCashMxnCents: 1 });
    expect(badId.statusCode).toBe(400);
    const badClose = await post('1/close', {});
    expect(badClose.statusCode).toBe(400);
  });

  it('moves cash within the drawer, and needs a supervisor above 2,000 MXN (T1.4)', async () => {
    const { state, post } = await setup();
    await post('open', { openingCashMxnCents: 300000 });
    state.sales = 100000;
    const move = (
      type: string,
      amountMxnCents: number,
      headers?: Record<string, string>
    ) =>
      post(
        'movements',
        { shiftId: 1, type, amountMxnCents, reason: 'x' },
        headers
      );
    expect((await move('IN', 50000)).statusCode).toBe(201);
    expect((await move('OUT', 450001)).json()).toMatchObject({
      detail: 'INSUFFICIENT_DRAWER_CASH_REJECT',
    });
    expect((await move('OUT', 200001)).json()).toMatchObject({
      detail: 'SUPERVISOR_PERMISSION_REQUIRED',
    });
    const big = await move('OUT', 200001, {
      'x-permissions': 'pos:shift,pos:supervisor',
    });
    expect(big.statusCode).toBe(201);
    const closed = await post('movements', {
      shiftId: 9,
      type: 'OUT',
      amountMxnCents: 1,
      reason: 'x',
    });
    expect(closed.json()).toMatchObject({ detail: 'SHIFT_NOT_OPEN_REJECT' });
    expect(state.audit.filter((a) => a === 'POS_CASH_MOVED')).toHaveLength(2);
  });

  it('closes with a blind count: exact, with notes, or with a supervisor (T1.2, T2.4)', async () => {
    const { state, post } = await setup();
    await post('open', { openingCashMxnCents: 100000 });
    const close = (
      countedCashMxnCents: number,
      notes?: string,
      headers?: Record<string, string>
    ) => post('1/close', { countedCashMxnCents, notes }, headers);
    expect((await close(99000)).json()).toMatchObject({
      detail: 'MISSING_DIFF_JUSTIFICATION_REJECT',
    });
    expect((await close(99000, 'corto')).json()).toMatchObject({
      detail: 'MISSING_DIFF_JUSTIFICATION_REJECT',
    });
    expect((await close(89999, 'faltó cambio en caja')).json()).toMatchObject({
      detail: 'SUPERVISOR_REQUIRED_FOR_LARGE_DIFF',
    });
    expect(
      (await close(100000, undefined, { 'x-user': OTHER })).json()
    ).toMatchObject({ detail: 'PERMISSION_DENIED' });
    const done = await close(99000, 'faltó cambio en caja');
    expect(done.statusCode).toBe(200);
    expect(done.json()).toEqual({
      id: 1,
      expectedCashMxnCents: 100000,
      countedCashMxnCents: 99000,
      differenceMxnCents: -1000,
    });
    expect(state.shifts[0].notes).toBe('faltó cambio en caja');
    expect((await close(100000)).json()).toMatchObject({
      detail: 'SHIFT_NOT_OPEN_REJECT',
    });
    const missing = await post('7/close', { countedCashMxnCents: 1 });
    expect(missing.json()).toMatchObject({ detail: 'SHIFT_NOT_OPEN_REJECT' });
  });

  it('lets a supervisor close another person’s exact shift without notes', async () => {
    const { state, post } = await setup();
    await post('open', { openingCashMxnCents: 100 });
    const done = await post(
      '1/close',
      { countedCashMxnCents: 100 },
      { 'x-user': OTHER, 'x-permissions': 'pos:shift,pos:supervisor' }
    );
    expect(done.statusCode).toBe(200);
    expect(state.shifts[0].notes).toBeNull();
  });
});
