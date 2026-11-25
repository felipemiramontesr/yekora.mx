import { describe, expect, it, vi } from 'vitest';
import {
  inviteStaffUser,
  listStaffRoles,
  listStaffUsers,
  updateStaffUser,
} from './staffClient';

const ID = 'a0000000-0000-4000-8000-000000000002';
const SELLER = {
  id: ID,
  email: 'leo@example.test',
  fullName: 'Leo Vendedor',
  roles: ['customer', 'staff_orders'],
  isActive: true,
  totpEnabled: false,
  createdAt: '2026-11-24T18:00:00.000Z',
};
const ROLE = {
  id: 'staff_orders',
  name: 'Vendedor',
  description: null,
  isActive: true,
  isSystem: false,
  assignableByAdmin: true,
  permissions: ['account:self', 'orders:manage'],
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

describe('client of the panel of users and roles (FC 072 F2)', () => {
  it('lists the staff with the session cookie and no Idempotency-Key', async () => {
    const fetchImpl = answering(200, { items: [SELLER] });
    await expect(listStaffUsers(fetchImpl)).resolves.toEqual({
      ok: true,
      data: { items: [SELLER] },
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://apiv1.yekora.mx/v1/admin/users');
    expect(init?.credentials).toBe('include');
    expect(init?.headers).not.toHaveProperty('Idempotency-Key');
    expect(init?.body).toBeUndefined();
  });

  it('lists the roles with their permissions and the catalog of the matrix', async () => {
    const fetchImpl = answering(200, {
      items: [ROLE],
      catalog: ['account:self', 'orders:manage'],
    });
    await expect(listStaffRoles(fetchImpl)).resolves.toMatchObject({
      ok: true,
      data: { items: [ROLE], catalog: ['account:self', 'orders:manage'] },
    });
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://apiv1.yekora.mx/v1/admin/roles'
    );
  });

  it('invites with e-mail, name and roles, under a fresh Idempotency-Key each time (T2.4)', async () => {
    const fetchImpl = answering(201, SELLER);
    const input = {
      email: 'leo@example.test',
      fullName: 'Leo Vendedor',
      roles: ['staff_orders'],
    };
    await expect(inviteStaffUser(input, fetchImpl)).resolves.toEqual({
      ok: true,
      data: SELLER,
    });
    await inviteStaffUser(input, fetchImpl);
    const keys = fetchImpl.mock.calls.map(
      ([, init]) => (init?.headers as Record<string, string>)['Idempotency-Key']
    );
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[0]).not.toBe(keys[1]);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: '{"email":"leo@example.test","fullName":"Leo Vendedor","roles":["staff_orders"]}',
    });
  });

  it('sends a PATCH to the account with the change', async () => {
    const fetchImpl = answering(200, { ...SELLER, isActive: false });
    await expect(
      updateStaffUser(ID, { isActive: false }, fetchImpl)
    ).resolves.toMatchObject({ ok: true, data: { isActive: false } });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`https://apiv1.yekora.mx/v1/admin/users/${ID}`);
    expect(init).toMatchObject({ method: 'PATCH', body: '{"isActive":false}' });
    expect(init?.headers).toHaveProperty('Idempotency-Key');
  });

  it.each([
    [403, { detail: 'ACTOR_UNAUTHORIZED' }, 'ACTOR_UNAUTHORIZED'],
    [403, { detail: 'TARGET_ROLE_FORBIDDEN' }, 'TARGET_ROLE_FORBIDDEN'],
    [
      403,
      { detail: 'ADMIN_CANNOT_ELEVATE_ADMIN' },
      'ADMIN_CANNOT_ELEVATE_ADMIN',
    ],
    [403, { detail: 'OWNER_IMMUTABLE' }, 'OWNER_IMMUTABLE'],
    [400, { detail: 'VALIDATION_OR_2FA_FAILED' }, 'VALIDATION_OR_2FA_FAILED'],
    [404, { detail: 'USER_NOT_FOUND' }, 'USER_NOT_FOUND'],
    [422, { detail: 'ROLE_NOT_FOUND' }, 'ROLE_NOT_FOUND'],
    [409, { detail: 'STAFF_ALREADY_EXISTS' }, 'STAFF_ALREADY_EXISTS'],
    [400, { detail: 'INVALID_REQUEST' }, 'INVALID_REQUEST'],
    [429, undefined, 'rate_limited'],
    [500, { detail: 'SOMETHING_ELSE' }, 'unknown'],
    [502, undefined, 'unknown'],
  ])('names a %i refusal by its code', async (status, body, reason) => {
    await expect(listStaffUsers(answering(status, body))).resolves.toEqual({
      ok: false,
      reason,
    });
  });

  it('refuses an answer outside the contract, and reports a transport failure', async () => {
    await expect(
      listStaffUsers(answering(200, { items: [{ id: 'x' }] }))
    ).resolves.toEqual({ ok: false, reason: 'invalid' });
    await expect(
      listStaffUsers(async () => {
        throw new TypeError('fetch failed');
      })
    ).resolves.toEqual({ ok: false, reason: 'offline' });
  });

  it('uses the global fetch by default', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"items":[]}', { status: 200 }));
    await listStaffUsers();
    await listStaffRoles();
    await inviteStaffUser({
      email: 'a@example.test',
      fullName: 'Ana',
      roles: ['staff_orders'],
    });
    await updateStaffUser(ID, { roles: ['staff_catalog'] });
    expect(spy).toHaveBeenCalledTimes(4);
    spy.mockRestore();
  });
});
