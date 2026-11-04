import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  confirm,
  enroll,
  forgetDevice,
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

/** A small anti-bot challenge whose secret number is 7. */
const SALT = 'a1b2c3?expires=1793000000';
const BOT = {
  algorithm: 'SHA-256',
  challenge: createHash('sha256').update(`${SALT}7`).digest('hex'),
  maxnumber: 10,
  salt: SALT,
  signature: 'f'.repeat(64),
};

/** A fetch that hands out a challenge first, then answers the request itself. */
function proved(status: number, body: unknown, challenge: unknown = BOT) {
  return vi.fn<typeof fetch>(async (url) =>
    (url as string).endsWith('/v1/auth/bot-challenge')
      ? new Response(JSON.stringify(challenge), { status: 200 })
      : new Response(JSON.stringify(body), { status })
  );
}

/** The URL and options of the call after the challenge. */
function provedCall(fetchImpl: ReturnType<typeof proved>) {
  return fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
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
  it('signs up with the session cookie allowed and a solved challenge, and reads the acceptance', async () => {
    const fetchImpl = proved(202, { status: 'accepted' });
    const body = { email: 'a@b.mx', password: 'x'.repeat(12), fullName: 'A' };
    expect(await register(body, { fetchImpl })).toEqual({
      ok: true,
      data: { status: 'accepted' },
    });
    const [url, init] = provedCall(fetchImpl);
    expect(url).toBe('https://apiv1.yekora.mx/v1/auth/register');
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
    const { altcha, ...rest } = JSON.parse(String(init.body)) as Record<
      string,
      unknown
    >;
    expect(rest).toEqual(body);
    expect(JSON.parse(atob(String(altcha)))).toEqual({ ...BOT, number: 7 });
  });

  it('never sends sign-in without a solved challenge (Enmienda 1, E1)', async () => {
    const refused = answer(503, { detail: 'AUTH_UNAVAILABLE' });
    expect(
      await login({ email: 'a@b.mx', password: 'p' }, { fetchImpl: refused })
    ).toEqual({ ok: false, reason: 'AUTH_UNAVAILABLE' });
    expect(refused).toHaveBeenCalledTimes(1);
    // A challenge no number solves can only be forged.
    const forged = proved(200, {}, { ...BOT, challenge: 'e'.repeat(64) });
    expect(
      await login({ email: 'a@b.mx', password: 'p' }, { fetchImpl: forged })
    ).toEqual({ ok: false, reason: 'invalid' });
    expect(forged).toHaveBeenCalledTimes(1);
    const spent = proved(400, { detail: 'BOT_CHALLENGE_FAILED' });
    expect(
      await login({ email: 'a@b.mx', password: 'p' }, { fetchImpl: spent })
    ).toEqual({ ok: false, reason: 'BOT_CHALLENGE_FAILED' });
  });

  it('signs in without a code on a trusted device (201), and asks to remember one (Enmienda 1, E2)', async () => {
    expect(
      await login(
        { email: 'a@b.mx', password: 'p' },
        { fetchImpl: proved(201, { status: 'signed_in' }) }
      )
    ).toEqual({ ok: true, data: { status: 'signed_in' } });
    const remembering = answer(200, { status: 'signed_in' });
    await verify(
      { challengeId: CHALLENGE, code: '123456', rememberDevice: true },
      { fetchImpl: remembering }
    );
    expect(JSON.parse(String(sent(remembering)[1].body))).toEqual({
      challengeId: CHALLENGE,
      code: '123456',
      rememberDevice: true,
    });
    const forget = answer(204);
    expect(await forgetDevice({ fetchImpl: forget })).toEqual({
      ok: true,
      data: null,
    });
    expect(sent(forget)).toEqual([
      'https://apiv1.yekora.mx/v1/account/forget-device',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    ]);
  });

  it('waits 25 s for a sleeping API before giving up (282_AN P1, T2.6d)', async () => {
    vi.useFakeTimers();
    try {
      const hanging = vi.fn(
        (_url: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError'))
            );
          })
      );
      let settled = false;
      const pending = me({ fetchImpl: hanging }).finally(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(24_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toEqual({ ok: false, reason: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
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
        { fetchImpl: proved(200, challenge) }
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
    await forgetDevice();
    await verify({ challengeId: CHALLENGE, code: '123456' });
    await logout();
    await me();
    await listOrders('account', { page: 1 });
    await readOrder('account', ORDER);
    await register({ email: 'a@b.mx', password: 'p', fullName: 'A' });
    await login({ email: 'a@b.mx', password: 'p' });
    await enroll(CHALLENGE);
    await confirm({ challengeId: CHALLENGE, code: '123456' });
    // Sign-up and sign-in stop at the challenge, which this answer does not fit.
    expect(fetchImpl).toHaveBeenCalledTimes(10);
  });
});
