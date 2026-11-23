import { describe, expect, it, vi } from 'vitest';
import { deliverOrder, prepareOrder, shipOrder } from './fulfillmentClient';

const NUMBER = 'YEK-2026-AB12CD34';
const RESULT = {
  orderNumber: NUMBER,
  fulfillment: 'PREPARING',
  carrier: null,
  trackingNumber: null,
  trackingUrl: null,
  shippedAt: null,
  deliveredAt: null,
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

describe('order fulfillment client (FC 068 F1)', () => {
  it('prepares with a POST, the session cookie, a fresh Idempotency-Key and no body', async () => {
    const fetchImpl = answering(200, RESULT);
    await expect(prepareOrder(NUMBER, fetchImpl)).resolves.toEqual({
      ok: true,
      data: RESULT,
    });
    await prepareOrder(NUMBER, fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      `https://apiv1.yekora.mx/v1/admin/orders/${NUMBER}/prepare`
    );
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' });
    expect(init?.body).toBeUndefined();
    expect(init?.headers).not.toHaveProperty('Content-Type');
    const keys = fetchImpl.mock.calls.map(
      ([, call]) => (call?.headers as Record<string, string>)['Idempotency-Key']
    );
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('ships with the carrier, the tracking number and the link as JSON', async () => {
    const fetchImpl = answering(200, { ...RESULT, fulfillment: 'SHIPPED' });
    const input = {
      carrier: 'DHL',
      trackingNumber: '1234567890',
      trackingUrl: 'https://www.dhl.com/track?id=1234567890',
    };
    await expect(shipOrder(NUMBER, input, fetchImpl)).resolves.toMatchObject({
      ok: true,
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`https://apiv1.yekora.mx/v1/admin/orders/${NUMBER}/ship`);
    expect(init).toMatchObject({ method: 'POST', body: JSON.stringify(input) });
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('delivers with a POST to /deliver', async () => {
    const fetchImpl = answering(200, { ...RESULT, fulfillment: 'DELIVERED' });
    await deliverOrder(NUMBER, fetchImpl);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      `https://apiv1.yekora.mx/v1/admin/orders/${NUMBER}/deliver`
    );
  });

  it.each([
    [409, { detail: 'ORDER_STATUS_CONFLICT' }, 'ORDER_STATUS_CONFLICT'],
    [404, { detail: 'ORDER_NOT_FOUND' }, 'ORDER_NOT_FOUND'],
    [400, { detail: 'ORDER_PAYLOAD_INVALID' }, 'ORDER_PAYLOAD_INVALID'],
    [403, { detail: 'PERMISSION_DENIED' }, 'PERMISSION_DENIED'],
    [403, { detail: 'SECOND_FACTOR_REQUIRED' }, 'SECOND_FACTOR_REQUIRED'],
    [
      401,
      { detail: 'SESSION_INVALID_OR_EXPIRED' },
      'SESSION_INVALID_OR_EXPIRED',
    ],
    [429, undefined, 'rate_limited'],
    [500, { detail: 'SOMETHING_ELSE' }, 'unknown'],
    [502, undefined, 'unknown'],
  ])('names a %i refusal by its code', async (status, body, reason) => {
    await expect(
      prepareOrder(NUMBER, answering(status, body))
    ).resolves.toEqual({ ok: false, reason });
  });

  it('refuses an answer outside the contract, and reports a transport failure', async () => {
    await expect(
      prepareOrder(NUMBER, answering(200, { orderNumber: NUMBER }))
    ).resolves.toEqual({ ok: false, reason: 'invalid' });
    await expect(
      prepareOrder(NUMBER, async () => {
        throw new TypeError('fetch failed');
      })
    ).resolves.toEqual({ ok: false, reason: 'offline' });
  });

  it('uses the global fetch by default', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(RESULT), { status: 200 }));
    await prepareOrder(NUMBER);
    await shipOrder(NUMBER, { carrier: 'DHL', trackingNumber: '1' });
    await deliverOrder(NUMBER);
    expect(spy).toHaveBeenCalledTimes(3);
    spy.mockRestore();
  });
});
