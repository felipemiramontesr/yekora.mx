import { describe, expect, it, vi } from 'vitest';
import {
  closeTill,
  listCounterProducts,
  moveTillCash,
  openTill,
  readReceipt,
  readShift,
  sell,
} from './posClient';

const API = 'https://apiv1.yekora.mx/v1/admin/pos';

const answering = (status: number, body: unknown) =>
  vi.fn<typeof fetch>(
    async () =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
  );

const headersOf = (init: RequestInit | undefined) =>
  init?.headers as Record<string, string>;

describe('client of the point of sale (FC 076 F4)', () => {
  it('reads with the cookie and no Idempotency-Key', async () => {
    const shift = answering(200, { shift: null });
    await expect(readShift(shift)).resolves.toEqual({
      ok: true,
      data: { shift: null },
    });
    const [url, init] = shift.mock.calls[0];
    expect(url).toBe(`${API}/shifts/current`);
    expect(init?.method).toBe('GET');
    expect(headersOf(init)['Idempotency-Key']).toBeUndefined();
    const products = answering(200, { items: [] });
    await listCounterProducts('  mo chila ', products);
    await listCounterProducts('   ', products);
    expect(products.mock.calls.map(([u]) => u)).toEqual([
      `${API}/products?q=mo%20chila`,
      `${API}/products`,
    ]);
    const receipt = answering(200, {
      orderNumber: 'YEK-2026-AAAA0001',
      widthMm: 58,
      lines: ['x'],
    });
    await readReceipt('YEK-2026-AAAA0001', 58, receipt);
    expect(receipt.mock.calls[0][0]).toBe(
      `${API}/orders/YEK-2026-AAAA0001/receipt?width=58`
    );
  });

  it('writes each action with a fresh Idempotency-Key to its route', async () => {
    const f = answering(400, { detail: 'INVALID_REQUEST' });
    await openTill(100, f);
    await moveTillCash(
      { shiftId: 1, type: 'IN', amountMxnCents: 1, reason: 'x' },
      f
    );
    await closeTill(1, { countedCashMxnCents: 1 }, f);
    await sell(
      { items: [{ sku: 'A', quantity: 1 }], payment: { method: 'POS_CASH' } },
      f
    );
    expect(f.mock.calls.map(([u]) => u)).toEqual([
      `${API}/shifts/open`,
      `${API}/shifts/movements`,
      `${API}/shifts/1/close`,
      `${API}/checkout`,
    ]);
    const keys = f.mock.calls.map(
      ([, init]) => headersOf(init)['Idempotency-Key']
    );
    expect(new Set(keys).size).toBe(4);
    expect(f.mock.calls[0][1]?.method).toBe('POST');
  });

  it('names a refusal by its code, and keeps unknown ones and floods apart', async () => {
    await expect(
      openTill(1, answering(409, { detail: 'POS_SHIFT_ALREADY_OPEN' }))
    ).resolves.toEqual({ ok: false, reason: 'POS_SHIFT_ALREADY_OPEN' });
    await expect(openTill(1, answering(500, undefined))).resolves.toEqual({
      ok: false,
      reason: 'unknown',
    });
    await expect(openTill(1, answering(429, undefined))).resolves.toEqual({
      ok: false,
      reason: 'rate_limited',
    });
  });
});
