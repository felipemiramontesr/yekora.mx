import { describe, expect, it, vi } from 'vitest';
import {
  confirmReturn,
  listReturns,
  prepareReturn,
  requestReturn,
} from './returnsClient';

const RETURN = {
  id: 7,
  orderNumber: 'YEK-2026-AAAA0001',
  status: 'REQUESTED',
  reason: 'DEFECT',
  comment: null,
  items: [{ sku: 'E2E-0001', quantity: 1 }],
  refundMxnCents: null,
  restock: null,
  createdAt: '2026-11-25T18:00:00.000Z',
  preparedAt: null,
  confirmedAt: null,
};

/** A fetch that answers once with `status` and `body`. */
const answering = (status: number, body: unknown) =>
  vi.fn<typeof fetch>(
    async () =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
  );

/** The Idempotency-Key a call carried, or undefined. */
const keyOf = (init: RequestInit | undefined) =>
  (init?.headers as Record<string, string>)['Idempotency-Key'];

describe('client of the returns screens (FC 073 F0)', () => {
  it('asks for a return with the cookie and a fresh Idempotency-Key (T2.2)', async () => {
    const fetchImpl = answering(201, RETURN);
    const input = {
      items: [{ sku: 'E2E-0001', quantity: 1 }],
      reason: 'DEFECT' as const,
    };
    await expect(
      requestReturn('YEK-2026-AAAA0001', input, fetchImpl)
    ).resolves.toEqual({ ok: true, data: RETURN });
    await requestReturn('YEK-2026-AAAA0001', input, fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      'https://apiv1.yekora.mx/v1/account/orders/YEK-2026-AAAA0001/returns'
    );
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('include');
    expect(JSON.parse(init?.body as string)).toEqual(input);
    expect(keyOf(init)).toMatch(/^[0-9a-f-]{36}$/);
    expect(keyOf(fetchImpl.mock.calls[1][1])).not.toBe(keyOf(init));
  });

  it('lists the board with no filter, or with one stage, and no key', async () => {
    const fetchImpl = answering(200, { items: [RETURN], total: 1 });
    await expect(listReturns(undefined, fetchImpl)).resolves.toEqual({
      ok: true,
      data: { items: [RETURN], total: 1 },
    });
    await listReturns('PREPARED', fetchImpl);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://apiv1.yekora.mx/v1/admin/returns'
    );
    expect(fetchImpl.mock.calls[1][0]).toBe(
      'https://apiv1.yekora.mx/v1/admin/returns?status=PREPARED'
    );
    const [, init] = fetchImpl.mock.calls[0];
    expect(keyOf(init)).toBeUndefined();
    expect(init?.body).toBeUndefined();
  });

  it('prepares with a fresh Idempotency-Key (T2.2)', async () => {
    const fetchImpl = answering(200, { ...RETURN, status: 'PREPARED' });
    await expect(
      prepareReturn(7, { refundMxnCents: 48500, restock: true }, fetchImpl)
    ).resolves.toMatchObject({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://apiv1.yekora.mx/v1/admin/returns/7/prepare');
    expect(keyOf(init)).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(init?.body as string)).toEqual({
      refundMxnCents: 48500,
      restock: true,
    });
  });

  it('confirms with no Idempotency-Key: the stage machine makes it safe to repeat', async () => {
    const fetchImpl = answering(200, { ...RETURN, status: 'REFUNDED' });
    await expect(
      confirmReturn(7, { manualReference: 'MP-123' }, fetchImpl)
    ).resolves.toMatchObject({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://apiv1.yekora.mx/v1/admin/returns/7/confirm');
    expect(keyOf(init)).toBeUndefined();
    expect(JSON.parse(init?.body as string)).toEqual({
      manualReference: 'MP-123',
    });
  });

  it.each([
    [400, 'RETURN_PAYLOAD_INVALID'],
    [400, 'IDEMP_KEY_MISSING'],
    [403, 'DUAL_CONTROL_VIOLATION_REJECT'],
    [403, 'PERMISSION_DENIED'],
    [404, 'RETURN_NOT_FOUND'],
    [409, 'WINDOW_EXPIRED_REJECT'],
    [409, 'RETURN_NOT_PREPARED_REJECT'],
    [502, 'REFUND_PROCESSOR_ERROR'],
    [503, 'REFUND_PROCESSOR_UNAVAILABLE'],
  ])('names the refusal %i %s by its machine code', async (status, code) => {
    const fetchImpl = answering(status, { detail: code });
    await expect(confirmReturn(7, {}, fetchImpl)).resolves.toEqual({
      ok: false,
      reason: code,
    });
  });

  it('keeps an unknown code as unknown and a 429 as rate_limited', async () => {
    await expect(
      confirmReturn(7, {}, answering(500, { detail: 'SOMETHING_NEW' }))
    ).resolves.toEqual({ ok: false, reason: 'unknown' });
    await expect(
      confirmReturn(7, {}, answering(500, undefined))
    ).resolves.toEqual({ ok: false, reason: 'unknown' });
    await expect(
      confirmReturn(7, {}, answering(429, undefined))
    ).resolves.toEqual({ ok: false, reason: 'rate_limited' });
  });

  it('calls an answer outside the contract invalid, and being offline offline', async () => {
    await expect(
      listReturns(undefined, answering(200, { items: 'no' }))
    ).resolves.toEqual({ ok: false, reason: 'invalid' });
    const down = vi.fn<typeof fetch>(async () => {
      throw new TypeError('network');
    });
    await expect(listReturns(undefined, down)).resolves.toEqual({
      ok: false,
      reason: 'offline',
    });
  });
});
