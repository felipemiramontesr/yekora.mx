// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse } from './authTypes';
import {
  clearSessionCache,
  readSessionCache,
  saveSessionCache,
} from './sessionCache';
import { clearSessionFirstName, saveSessionFirstName } from './sessionHint';

const KEY = 'yekora_session_cache_v1';

const account = {
  id: 'b0000000-0000-4000-8000-000000000001',
  email: 'ana@example.test',
  fullName: 'Ana Pérez',
  roles: ['customer'],
  permissions: ['account:self'],
  postalCode: '06600',
  stateCode: 'CMX',
  phone: '5512345678',
} as MeResponse;

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('the session cache (FC 053 F2)', () => {
  it('keeps and gives back the id, name, roles and permissions', () => {
    saveSessionCache(account, 'Ana');
    expect(readSessionCache()).toEqual({
      userId: account.id,
      firstName: 'Ana',
      roles: ['customer'],
      permissions: ['account:self'],
    });
  });

  it('never writes the e-mail, phone, postal code, state or an address (T2.2)', () => {
    saveSessionCache(
      {
        ...account,
        addresses: [{ street: 'Calle 1' }],
      } as unknown as MeResponse,
      'Ana'
    );
    const stored = sessionStorage.getItem(KEY) ?? '';
    for (const secret of [
      'ana@example.test',
      '5512345678',
      '06600',
      'CMX',
      'Calle 1',
      'email',
      'phone',
      'postalCode',
      'stateCode',
      'address',
    ]) {
      expect(stored).not.toContain(secret);
    }
    expect(Object.keys(JSON.parse(stored)).sort()).toEqual([
      'firstName',
      'permissions',
      'roles',
      'userId',
    ]);
  });

  it('is erased on demand, and when the hint is erased: signing out or a 401 (T2.4)', () => {
    saveSessionCache(account, 'Ana');
    clearSessionCache();
    expect(readSessionCache()).toBeNull();
    saveSessionCache(account, 'Ana');
    saveSessionFirstName('Ana');
    clearSessionFirstName();
    expect(readSessionCache()).toBeNull();
  });

  it('reads nothing from anything this module did not write', () => {
    expect(readSessionCache()).toBeNull();
    for (const bad of [
      'not json',
      'null',
      '3',
      '{}',
      '{"userId":1,"firstName":"a","roles":[],"permissions":[]}',
      '{"userId":"a","firstName":2,"roles":[],"permissions":[]}',
      '{"userId":"a","firstName":"a","roles":"x","permissions":[]}',
      '{"userId":"a","firstName":"a","roles":[],"permissions":[1]}',
    ]) {
      sessionStorage.setItem(KEY, bad);
      expect(readSessionCache()).toBeNull();
    }
  });

  it('does nothing, and never throws, when storage is blocked', () => {
    const blocked = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(blocked);
    expect(() => saveSessionCache(account, 'Ana')).not.toThrow();
    expect(readSessionCache()).toBeNull();
    expect(() => clearSessionCache()).not.toThrow();
  });
});
