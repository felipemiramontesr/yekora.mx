import { describe, expect, it, vi } from 'vitest';
import {
  inviteAdminUser,
  listAdminUsers,
  updateAdminUser,
} from './adminUsersClient';

const ID = 'a0000000-0000-4000-8000-000000000002';
const ADMIN = {
  id: ID,
  email: 'zoe@example.test',
  fullName: 'Zoe Admin',
  roles: ['admin', 'customer'],
  isActive: true,
  totpEnabled: false,
  createdAt: '2026-11-11T18:00:00.000Z',
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

describe('administrators console client (FC 044 F2)', () => {
  it('lists with the session cookie and no Idempotency-Key', async () => {
    const fetchImpl = answering(200, { items: [ADMIN] });
    await expect(listAdminUsers(fetchImpl)).resolves.toEqual({
      ok: true,
      data: { items: [ADMIN] },
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://apiv1.yekora.mx/v1/admin/admins');
    expect(init?.credentials).toBe('include');
    expect(init?.headers).not.toHaveProperty('Idempotency-Key');
    expect(init?.body).toBeUndefined();
  });

  it('invites with e-mail and name only, under a fresh Idempotency-Key each time (T2.2)', async () => {
    const fetchImpl = answering(201, ADMIN);
    const input = { email: 'zoe@example.test', fullName: 'Zoe Admin' };
    await expect(inviteAdminUser(input, fetchImpl)).resolves.toEqual({
      ok: true,
      data: ADMIN,
    });
    await inviteAdminUser(input, fetchImpl);
    const keys = fetchImpl.mock.calls.map(
      ([, init]) => (init?.headers as Record<string, string>)['Idempotency-Key']
    );
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[0]).not.toBe(keys[1]);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: '{"email":"zoe@example.test","fullName":"Zoe Admin"}',
    });
  });

  it('sends a PATCH to the account with the change', async () => {
    const fetchImpl = answering(200, { ...ADMIN, isActive: false });
    await expect(
      updateAdminUser(ID, { isActive: false }, fetchImpl)
    ).resolves.toMatchObject({ ok: true, data: { isActive: false } });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`https://apiv1.yekora.mx/v1/admin/admins/${ID}`);
    expect(init).toMatchObject({ method: 'PATCH', body: '{"isActive":false}' });
    expect(init?.headers).toHaveProperty('Idempotency-Key');
  });

  it.each([
    [403, { detail: 'OWNER_ROLE_REQUIRED' }, 'OWNER_ROLE_REQUIRED'],
    [403, { detail: 'OWNER_IMMUTABLE' }, 'OWNER_IMMUTABLE'],
    [409, { detail: 'ADMIN_ALREADY_EXISTS' }, 'ADMIN_ALREADY_EXISTS'],
    [404, { detail: 'ADMIN_NOT_FOUND' }, 'ADMIN_NOT_FOUND'],
    [429, undefined, 'rate_limited'],
    [500, { detail: 'SOMETHING_ELSE' }, 'unknown'],
    [502, undefined, 'unknown'],
  ])('names a %i refusal by its code', async (status, body, reason) => {
    await expect(listAdminUsers(answering(status, body))).resolves.toEqual({
      ok: false,
      reason,
    });
  });

  it('refuses an answer outside the contract, and reports a transport failure', async () => {
    await expect(
      listAdminUsers(answering(200, { items: [{ id: 'x' }] }))
    ).resolves.toEqual({ ok: false, reason: 'invalid' });
    await expect(
      listAdminUsers(async () => {
        throw new TypeError('fetch failed');
      })
    ).resolves.toEqual({ ok: false, reason: 'offline' });
  });

  it('uses the global fetch by default', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"items":[]}', { status: 200 }));
    await listAdminUsers();
    await inviteAdminUser({ email: 'a@example.test', fullName: 'Ana' });
    await updateAdminUser(ID, { revokeAdmin: true });
    expect(spy).toHaveBeenCalledTimes(3);
    spy.mockRestore();
  });
});
