// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logout, me } from '@/lib/api/accountClient';
import {
  getHeaderUser,
  signOutFromHeader,
  subscribeHeaderUser,
  syncHeaderUser,
} from './headerSession';
import { readSessionFirstName, saveSessionFirstName } from './sessionHint';

vi.mock('@/lib/api/accountClient', () => ({ me: vi.fn(), logout: vi.fn() }));

const api = { me: vi.mocked(me), logout: vi.mocked(logout) };
const USER = {
  id: 'b0000000-0000-4000-8000-000000000001',
  email: 'ana@example.test',
  fullName: 'Ana Flores Baca',
  roles: ['customer'],
  permissions: ['account:self'],
  postalCode: '98000',
};
const ok = () => ({ ok: true as const, data: USER }) as never;
const no = (reason: string) => ({ ok: false as const, reason }) as never;

beforeEach(async () => {
  localStorage.clear();
  api.me.mockReset();
  api.logout.mockReset();
  api.logout.mockResolvedValue({ ok: true, data: null } as never);
  await syncHeaderUser();
});

afterEach(() => localStorage.clear());

describe('header session (FC 047 T1.1, T2.3)', () => {
  it('asks the API nothing without a hint, and knows no one', async () => {
    await syncHeaderUser();
    expect(api.me).not.toHaveBeenCalled();
    expect(getHeaderUser()).toBeNull();
  });

  it('keeps the account the API confirms, only in memory, and tells the controls', async () => {
    saveSessionFirstName('Old');
    api.me.mockResolvedValue(ok());
    const heard = vi.fn();
    const stop = subscribeHeaderUser(heard);
    await syncHeaderUser();
    expect(getHeaderUser()).toEqual(USER);
    expect(heard).toHaveBeenCalledTimes(1);
    // The hint is the first name only; the postal code is never stored in the browser.
    expect(readSessionFirstName()).toBe('Ana');
    expect(JSON.stringify({ ...localStorage })).not.toContain('98000');
    stop();
    await syncHeaderUser();
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('asks once at a time, so two controls never ask twice', async () => {
    saveSessionFirstName('Ana');
    let answer!: (value: unknown) => void;
    api.me.mockReturnValueOnce(
      new Promise((resolve) => (answer = resolve)) as never
    );
    const first = syncHeaderUser();
    await syncHeaderUser();
    answer(ok());
    await first;
    expect(api.me).toHaveBeenCalledTimes(1);
  });

  it('erases the hint and the account when the session is found expired', async () => {
    saveSessionFirstName('Ana');
    api.me.mockResolvedValueOnce(ok());
    await syncHeaderUser();
    api.me.mockResolvedValueOnce(no('SESSION_INVALID_OR_EXPIRED'));
    await syncHeaderUser();
    expect(readSessionFirstName()).toBeNull();
    expect(getHeaderUser()).toBeNull();
  });

  it('keeps what it knows when the API cannot be reached: offline is not a signed-out session', async () => {
    saveSessionFirstName('Ana');
    api.me.mockResolvedValueOnce(ok());
    await syncHeaderUser();
    api.me.mockResolvedValueOnce(no('offline'));
    await syncHeaderUser();
    expect(readSessionFirstName()).toBe('Ana');
    expect(getHeaderUser()).toEqual(USER);
  });

  it('forgets the account when the hint disappears, and signs out through the API first', async () => {
    saveSessionFirstName('Ana');
    api.me.mockResolvedValueOnce(ok());
    await syncHeaderUser();
    localStorage.clear();
    await syncHeaderUser();
    expect(getHeaderUser()).toBeNull();
    saveSessionFirstName('Ana');
    api.me.mockResolvedValueOnce(ok());
    await syncHeaderUser();
    await signOutFromHeader();
    expect(api.logout).toHaveBeenCalledTimes(1);
    expect(readSessionFirstName()).toBeNull();
    expect(getHeaderUser()).toBeNull();
  });
});
