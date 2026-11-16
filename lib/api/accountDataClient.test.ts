import { describe, expect, it, vi } from 'vitest';
import {
  createAddress,
  deleteAddress,
  listAddresses,
  updateAddress,
  updateProfile,
} from './accountDataClient';

const ID = 'a0000000-0000-4000-8000-000000000001';
const VIEW = {
  id: ID,
  isDefault: true,
  isComplete: true,
  stateCode: 'ZAC',
  postalCode: '98612',
  label: 'Casa',
  name: 'Ana Pérez',
  phone: '4929421780',
  street: 'Av. Barones',
  exteriorNumber: '209',
  interiorNumber: null,
  neighborhood: 'Las Américas',
  municipality: 'Guadalupe',
  references: null,
};
const ADDRESS = {
  name: 'Ana Pérez',
  phone: '4929421780',
  street: 'Av. Barones',
  exteriorNumber: '209',
  neighborhood: 'Las Américas',
  municipality: 'Guadalupe',
  stateCode: 'ZAC',
  postalCode: '98612',
};

/** A fetch that answers once with `status` and `body` (no body for undefined). */
const answering = (status: number, body: unknown) =>
  vi.fn<typeof fetch>(
    async () =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
  );

const headersOf = (fetchImpl: ReturnType<typeof answering>) =>
  fetchImpl.mock.calls[0][1]?.headers as Record<string, string>;

describe('data of the account client (FC 051)', () => {
  it('lists the book with the session cookie and no Idempotency-Key', async () => {
    const fetchImpl = answering(200, { items: [VIEW], max: 5 });
    await expect(listAddresses(fetchImpl)).resolves.toEqual({
      ok: true,
      data: { items: [VIEW], max: 5 },
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://apiv1.yekora.mx/v1/account/addresses');
    expect(init?.credentials).toBe('include');
    expect(headersOf(fetchImpl)).not.toHaveProperty('Idempotency-Key');
  });

  it('changes the profile under a fresh Idempotency-Key and reads only the name back', async () => {
    const fetchImpl = answering(200, { fullName: 'Ana Pérez' });
    await expect(
      updateProfile({ fullName: 'Ana Pérez', phone: '4929421780' }, fetchImpl)
    ).resolves.toEqual({ ok: true, data: { fullName: 'Ana Pérez' } });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://apiv1.yekora.mx/v1/account/profile');
    expect(init).toMatchObject({
      method: 'PATCH',
      body: '{"fullName":"Ana Pérez","phone":"4929421780"}',
    });
    expect(headersOf(fetchImpl)['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('adds an address with a new key each time', async () => {
    const fetchImpl = answering(201, {
      id: ID,
      isDefault: true,
      isComplete: true,
    });
    await createAddress({ ...ADDRESS, isDefault: true }, fetchImpl);
    await createAddress(ADDRESS, fetchImpl);
    const keys = fetchImpl.mock.calls.map(
      ([, init]) => (init?.headers as Record<string, string>)['Idempotency-Key']
    );
    expect(keys[0]).not.toBe(keys[1]);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: 'POST' });
  });

  it('edits an address, or only makes it the default', async () => {
    const fetchImpl = answering(200, {
      id: ID,
      isDefault: true,
      isComplete: true,
    });
    await expect(
      updateAddress(ID, { isDefault: true }, fetchImpl)
    ).resolves.toMatchObject({ ok: true, data: { isDefault: true } });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`https://apiv1.yekora.mx/v1/account/addresses/${ID}`);
    expect(init).toMatchObject({
      method: 'PATCH',
      body: '{"isDefault":true}',
    });
  });

  it('deletes an address: the API answers 204 with nothing', async () => {
    const fetchImpl = answering(204, undefined);
    await expect(deleteAddress(ID, fetchImpl)).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`https://apiv1.yekora.mx/v1/account/addresses/${ID}`);
    expect(init).toMatchObject({ method: 'DELETE' });
    expect(init?.body).toBeUndefined();
    expect(headersOf(fetchImpl)).toHaveProperty('Idempotency-Key');
  });

  it.each([
    [400, { detail: 'INVALID_ADDRESS' }, 'INVALID_ADDRESS'],
    [400, { detail: 'INVALID_REQUEST' }, 'INVALID_REQUEST'],
    [404, { detail: 'ADDRESS_NOT_FOUND' }, 'ADDRESS_NOT_FOUND'],
    [409, { detail: 'ADDRESS_LIMIT_REACHED' }, 'ADDRESS_LIMIT_REACHED'],
    [503, { detail: 'SERVICE_UNAVAILABLE' }, 'SERVICE_UNAVAILABLE'],
    [
      401,
      { detail: 'SESSION_INVALID_OR_EXPIRED' },
      'SESSION_INVALID_OR_EXPIRED',
    ],
    [429, undefined, 'rate_limited'],
    [500, { detail: 'SOMETHING_ELSE' }, 'unknown'],
    [502, undefined, 'unknown'],
  ])('names the refusal %s %j as %s', async (status, body, reason) => {
    await expect(
      createAddress(ADDRESS, answering(status, body))
    ).resolves.toEqual({ ok: false, reason });
  });

  it('never throws: an answer outside the contract is invalid, a lost connection offline', async () => {
    await expect(
      listAddresses(answering(200, { items: 'no' }))
    ).resolves.toEqual({ ok: false, reason: 'invalid' });
    await expect(
      listAddresses(vi.fn<typeof fetch>().mockRejectedValue(new TypeError('x')))
    ).resolves.toEqual({ ok: false, reason: 'offline' });
  });
});
