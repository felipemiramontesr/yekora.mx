import { describe, expect, it, vi } from 'vitest';
import {
  readShippingAdmin,
  saveShippingConfig,
  saveShippingRules,
} from './shippingAdminClient';

const VIEW = {
  config: {
    strategyId: 2,
    isFreeShippingActive: false,
    freeShippingThresholdMxnCents: null,
  },
  strategies: [
    {
      id: 2,
      code: 'ZONE_RATE',
      nameEs: 'Por estado',
      nameEn: 'By state',
      administrable: true,
    },
  ],
  classes: [],
  zones: [
    { id: 1, code: 'AGU', nameEs: 'Aguascalientes', nameEn: 'Aguascalientes' },
  ],
  rules: [{ zoneId: 1, rateMxnCents: 15000 }],
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

describe('shipping console client (FC 061 F1)', () => {
  it('reads with the session cookie and no Idempotency-Key', async () => {
    const fetchImpl = answering(200, VIEW);
    await expect(readShippingAdmin(fetchImpl)).resolves.toEqual({
      ok: true,
      data: VIEW,
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://apiv1.yekora.mx/v1/admin/shipping');
    expect(init?.credentials).toBe('include');
    expect(init?.headers).not.toHaveProperty('Idempotency-Key');
  });

  it('saves the configuration with a PUT under a fresh Idempotency-Key each time', async () => {
    const fetchImpl = answering(200, VIEW);
    const input = {
      strategyId: 2,
      isFreeShippingActive: true,
      freeShippingThresholdMxnCents: 150000,
    };
    await expect(saveShippingConfig(input, fetchImpl)).resolves.toMatchObject({
      ok: true,
    });
    await saveShippingConfig(input, fetchImpl);
    const keys = fetchImpl.mock.calls.map(
      ([, init]) => (init?.headers as Record<string, string>)['Idempotency-Key']
    );
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[0]).not.toBe(keys[1]);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://apiv1.yekora.mx/v1/admin/shipping/config'
    );
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify(input),
    });
  });

  it('saves the rates with a PUT to /rules', async () => {
    const fetchImpl = answering(200, VIEW);
    const input = { rules: [{ zoneId: 1, rateMxnCents: 100 }] };
    await saveShippingRules(input, fetchImpl);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://apiv1.yekora.mx/v1/admin/shipping/rules'
    );
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify(input),
    });
  });

  it.each([
    [403, { detail: 'PERMISSION_DENIED' }, 'PERMISSION_DENIED'],
    [403, { detail: 'SECOND_FACTOR_REQUIRED' }, 'SECOND_FACTOR_REQUIRED'],
    [
      401,
      { detail: 'SESSION_INVALID_OR_EXPIRED' },
      'SESSION_INVALID_OR_EXPIRED',
    ],
    [
      409,
      { detail: 'SHIPPING_STRATEGY_UNAVAILABLE' },
      'SHIPPING_STRATEGY_UNAVAILABLE',
    ],
    [400, { detail: 'SHIPPING_ZONE_UNKNOWN' }, 'SHIPPING_ZONE_UNKNOWN'],
    [400, { detail: 'INVALID_REQUEST' }, 'INVALID_REQUEST'],
    [429, undefined, 'rate_limited'],
    [500, { detail: 'SOMETHING_ELSE' }, 'unknown'],
    [502, undefined, 'unknown'],
  ])('names a %i refusal by its code', async (status, body, reason) => {
    await expect(readShippingAdmin(answering(status, body))).resolves.toEqual({
      ok: false,
      reason,
    });
  });

  it('refuses an answer outside the contract, and reports a transport failure', async () => {
    await expect(
      readShippingAdmin(answering(200, { config: {} }))
    ).resolves.toEqual({ ok: false, reason: 'invalid' });
    await expect(
      readShippingAdmin(async () => {
        throw new TypeError('fetch failed');
      })
    ).resolves.toEqual({ ok: false, reason: 'offline' });
  });

  it('uses the global fetch by default', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(VIEW), { status: 200 }));
    await readShippingAdmin();
    await saveShippingConfig({
      strategyId: 2,
      isFreeShippingActive: false,
      freeShippingThresholdMxnCents: null,
    });
    await saveShippingRules({ rules: [] });
    expect(spy).toHaveBeenCalledTimes(3);
    spy.mockRestore();
  });
});
