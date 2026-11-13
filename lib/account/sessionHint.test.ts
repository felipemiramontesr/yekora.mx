// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSessionFirstName,
  firstNameOf,
  readSessionFirstName,
  saveSessionFirstName,
  subscribeSessionHint,
} from './sessionHint';

const KEY = 'yekora_session_first_name_v1';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('firstNameOf (FC 046 T2.2)', () => {
  it('keeps only the first word of the name, trimmed', () => {
    expect(firstNameOf('Felipe Miramontes Ruiz')).toBe('Felipe');
    expect(firstNameOf('  María   José  ')).toBe('María');
    expect(firstNameOf('Ana')).toBe('Ana');
    expect(firstNameOf('   ')).toBe('');
  });

  it('cuts a very long first name to 24 characters, never in the middle of a character', () => {
    expect(firstNameOf('A'.repeat(40))).toHaveLength(24);
    expect(Array.from(firstNameOf('😀'.repeat(30)))).toHaveLength(24);
  });
});

describe('the local hint of the first name (FC 046 T1.1, T2.2)', () => {
  it('keeps the first name, reads it back and erases it', () => {
    expect(readSessionFirstName()).toBeNull();
    saveSessionFirstName('Felipe');
    expect(localStorage.getItem(KEY)).toBe('Felipe');
    expect(readSessionFirstName()).toBe('Felipe');
    clearSessionFirstName();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(readSessionFirstName()).toBeNull();
  });

  it('never shows or keeps anything that is not a plain first name, an e-mail least of all', () => {
    localStorage.setItem(KEY, 'ana@example.test');
    expect(readSessionFirstName()).toBeNull();
    localStorage.setItem(KEY, 'Ana Flores');
    expect(readSessionFirstName()).toBeNull();
    saveSessionFirstName('Ana');
    saveSessionFirstName('ana@example.test');
    expect(localStorage.getItem(KEY)).toBeNull();
    saveSessionFirstName('Ana');
    saveSessionFirstName('');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('tells this tab when it changes, and the other tabs through the storage event', () => {
    const listener = vi.fn();
    const stop = subscribeSessionHint(listener);
    saveSessionFirstName('Rosa');
    expect(listener).toHaveBeenCalledTimes(1);
    clearSessionFirstName();
    expect(listener).toHaveBeenCalledTimes(2);
    // Another tab: its own key, a cleared storage (no key) and an unrelated key.
    globalThis.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    expect(listener).toHaveBeenCalledTimes(3);
    globalThis.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(listener).toHaveBeenCalledTimes(4);
    globalThis.dispatchEvent(new StorageEvent('storage', { key: 'other' }));
    expect(listener).toHaveBeenCalledTimes(4);
    stop();
    saveSessionFirstName('Rosa');
    globalThis.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it('does not break, and tells nobody, when the browser blocks storage', () => {
    const listener = vi.fn();
    subscribeSessionHint(listener);
    const blocked = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(blocked);
    expect(readSessionFirstName()).toBeNull();
    expect(() => saveSessionFirstName('Ana')).not.toThrow();
    expect(() => clearSessionFirstName()).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });
});
