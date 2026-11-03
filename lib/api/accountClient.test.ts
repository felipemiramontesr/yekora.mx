import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  confirm,
  enroll,
  listOrders,
  login,
  logout,
  me,
  readOrder,
  register,
  verify,
} from './accountClient';

const CHALLENGE = 'c0000000-0000-4000-8000-000000000001';
const ORDER = 'YEK-2026-AB12CD34';

/** A fetch that answers once with this status and body. */
function answer(status: number, body?: unknown) {
  return vi.fn(async () =>
    body === undefined
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })
  );
}

/** The URL and options of the only call. */
function sent(fetchImpl: ReturnType<typeof answer>) {
  return fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
}

const summary = {
  orderNumber: ORDER,
  status: 'PAID',
  method: 'CARD',
  itemsTotalMxnCents: 185000,
  shippingTotalMxnCents: 15000,
  totalMxnCents: 200000,
  createdAt: '2026-11-01T10:00:00.000Z',
  expiresAt: '2026-11-01T11:00:00.000Z',
  paidAt: '2026-11-01T10:20:00.000Z',
  isTest: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('account client (FC 028 F2)', () => {
  it('signs up with the session cookie allowed, and reads the acceptance', async () => {
    const fetchImpl = answer(202, { status: 'accepted' });
    const body = { email: 'a@b.mx', password: 'x'.repeat(12), fullName: 'A' };
    expect(await register(body, { fetchImpl })).toEqual({
      ok: true,
      data: { status: 'accepted' },
    });
    const [url, init] = sent(fetchImpl);
    expect(url).toBe('https://apiv1.yekora.mx/v1/auth/register');
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
  });

  it('opens a challenge, sends its code, enrols and confirms the authenticator', async () => {
    const challenge = {
      challengeId: CHALLENGE,
      next: 'verify',
      channel: 'email',
    };
    expect(
      await login(
        { email: 'a@b.mx', password: 'p' },
        { fetchImpl: answer(200, challenge) }
      )
    ).toEqual({ ok: true, data: challenge });
    expect(
      await verify(
        { challengeId: CHALLENGE, code: '123456' },
        { fetchImpl: answer(200, { status: 'signed_in' }) }
      )
    ).toEqual({ ok: true, data: { status: 'signed_in' } });
    const secret = {
      secret: 'JBSWY3DPEHPK3PXP',
      otpauthUri: 'otpauth://totp/x',
    };
    const enrolling = answer(200, secret);
    expect(await enroll(CHALLENGE, { fetchImpl: enrolling })).toEqual({
      ok: true,
      data: secret,
    });
    expect(sent(enrolling)[1].body).toBe(
      JSON.stringify({ challengeId: CHALLENGE })
    );
    const codes = Array.from({ length: 8 }, (_, i) => `1234567${i}`);
    expect(
      await confirm(
        { challengeId: CHALLENGE, code: '123456' },
        { fetchImpl: answer(200, { backupCodes: codes }) }
      )
    ).toEqual({ ok: true, data: { backupCodes: codes } });
  });

  it.each([
    [409, 'TOTP_NOT_ENROLLED', 'TOTP_NOT_ENROLLED'],
    [401, 'INVALID_CODE', 'INVALID_CODE'],
    [503, 'MAIL_UNAVAILABLE', 'MAIL_UNAVAILABLE'],
    [500, 'SOMETHING_NEW', 'server'],
    [404, undefined, 'not_found'],
    [429, undefined, 'rate_limited'],
  ])('reads a %i refusal as %s', async (status, detail, reason) => {
    const fetchImpl = answer(
      status,
      detail === undefined ? undefined : { detail }
    );
    expect(
      await verify({ challengeId: CHALLENGE, code: '123456' }, { fetchImpl })
    ).toEqual({ ok: false, reason });
  });

  it('refuses an answer outside the contract, and never throws on a network failure', async () => {
    expect(await me({ fetchImpl: answer(200, { id: 'nope' }) })).toEqual({
      ok: false,
      reason: 'invalid',
    });
    const down = vi.fn(async () => {
      throw new TypeError('network down');
    });
    expect(await me({ fetchImpl: down })).toEqual({
      ok: false,
      reason: 'offline',
    });
    vi.stubGlobal('navigator', { onLine: false });
    expect(await logout({ fetchImpl: down })).toEqual({
      ok: false,
      reason: 'offline',
    });
  });

  it('reads who is signed in, with the cookie and no body', async () => {
    const user = {
      id: 'b0000000-0000-4000-8000-000000000001',
      email: 'ana@example.test',
      fullName: 'Ana',
      roles: ['customer'],
      permissions: ['account:self'],
    };
    const fetchImpl = answer(200, user);
    expect(await me({ fetchImpl })).toEqual({ ok: true, data: user });
    const [url, init] = sent(fetchImpl);
    expect(url).toBe('https://apiv1.yekora.mx/v1/account/me');
    expect(init).toMatchObject({ method: 'GET', credentials: 'include' });
    expect(init.body).toBeUndefined();
    expect(init.headers).toEqual({ Accept: 'application/json' });
  });

  it('signs out, or says why not', async () => {
    const out = answer(204);
    expect(await logout({ fetchImpl: out })).toEqual({ ok: true, data: null });
    expect(sent(out)[1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
    });
    expect(
      await logout({
        fetchImpl: answer(401, { detail: 'SESSION_INVALID_OR_EXPIRED' }),
      })
    ).toEqual({ ok: false, reason: 'SESSION_INVALID_OR_EXPIRED' });
  });

  it('lists the buyer’s orders or the panel’s by status, and reads one', async () => {
    const page = { items: [summary], page: 2, pageSize: 20, total: 21 };
    const mine = answer(200, page);
    expect(
      await listOrders('account', { page: 2 }, { fetchImpl: mine })
    ).toEqual({ ok: true, data: page });
    expect(sent(mine)[0]).toBe(
      'https://apiv1.yekora.mx/v1/account/orders?page=2'
    );
    const panel = answer(200, page);
    await listOrders(
      'admin',
      { page: 1, status: 'PAID' },
      { fetchImpl: panel }
    );
    expect(sent(panel)[0]).toBe(
      'https://apiv1.yekora.mx/v1/admin/orders?page=1&status=PAID'
    );
    const detail = { ...summary, lines: [], paymentEvents: [] };
    const one = answer(200, detail);
    expect(await readOrder('admin', ORDER, { fetchImpl: one })).toEqual({
      ok: true,
      data: detail,
    });
    expect(sent(one)[0]).toBe(
      `https://apiv1.yekora.mx/v1/admin/orders/${ORDER}`
    );
  });

  it('uses the browser fetch by default', async () => {
    const fetchImpl = answer(200, { status: 'signed_in' });
    vi.stubGlobal('fetch', fetchImpl);
    await verify({ challengeId: CHALLENGE, code: '123456' });
    await logout();
    await me();
    await listOrders('account', { page: 1 });
    await readOrder('account', ORDER);
    await register({ email: 'a@b.mx', password: 'p', fullName: 'A' });
    await login({ email: 'a@b.mx', password: 'p' });
    await enroll(CHALLENGE);
    await confirm({ challengeId: CHALLENGE, code: '123456' });
    expect(fetchImpl).toHaveBeenCalledTimes(9);
  });
});
