// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSessionFirstName,
  saveSessionFirstName,
} from '@/lib/account/sessionHint';
import { me } from '@/lib/api/accountClient';
import { useHeaderAccount } from './useHeaderAccount';

vi.mock('@/lib/api/accountClient', () => ({ me: vi.fn(), logout: vi.fn() }));

const api = { me: vi.mocked(me) };
const USER = {
  id: 'b0000000-0000-4000-8000-000000000001',
  email: 'ana@example.test',
  fullName: 'Ana Flores Baca',
  roles: ['customer'],
  permissions: ['account:self'],
  postalCode: '98000',
};

beforeEach(() => {
  localStorage.clear();
  api.me.mockResolvedValue({ ok: true, data: USER } as never);
});

afterEach(() => {
  cleanup();
  clearSessionFirstName();
  vi.clearAllMocks();
});

describe('account of the header (FC 047 T1.1)', () => {
  it('is nobody, and asks the API nothing, for a visitor without a hint', async () => {
    const { result } = renderHook(() => useHeaderAccount());
    expect(result.current).toEqual({ firstName: null, user: null });
    expect(api.me).not.toHaveBeenCalled();
  });

  it('gives the first name at once and the confirmed account when the API answers', async () => {
    saveSessionFirstName('Ana');
    const { result } = renderHook(() => useHeaderAccount());
    expect(result.current.firstName).toBe('Ana');
    await waitFor(() => expect(result.current.user).toEqual(USER));
    expect(api.me).toHaveBeenCalledTimes(1);
  });

  it('marks the document while there is a hint, and drops a mark the raw value did not deserve (FC 053 T1.1)', async () => {
    const marked = () => document.documentElement.hasAttribute('data-session');
    // The head script marks from the raw value: a stored e-mail is no hint, and the hook says so.
    document.documentElement.setAttribute('data-session', '');
    localStorage.setItem('yekora_session_first_name_v1', 'ana@example.test');
    renderHook(() => useHeaderAccount());
    expect(marked()).toBe(false);
    cleanup();
    saveSessionFirstName('Ana');
    document.documentElement.removeAttribute('data-session');
    const { result } = renderHook(() => useHeaderAccount());
    expect(result.current.firstName).toBe('Ana');
    expect(marked()).toBe(true);
    await waitFor(() => expect(result.current.user).toEqual(USER));
  });

  it('follows the hint when someone signs in or out, in this tab or another', async () => {
    const { result } = renderHook(() => useHeaderAccount());
    act(() => saveSessionFirstName('Ana'));
    await waitFor(() => expect(result.current.user).toEqual(USER));
    act(() => clearSessionFirstName());
    await waitFor(() =>
      expect(result.current).toEqual({ firstName: null, user: null })
    );
  });
});
