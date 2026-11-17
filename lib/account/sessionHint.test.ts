// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSessionFirstName,
  firstNameOf,
  markSession,
  readSessionFirstName,
  saveSessionFirstName,
  SESSION_MARK_SCRIPT,
  subscribeSessionHint,
} from './sessionHint';

const KEY = 'yekora_session_first_name_v1';

const marked = () => document.documentElement.hasAttribute('data-session');

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-session');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the mark of the document (FC 053 T1.1)', () => {
  /** Runs the script of the head the way the browser does, before anything else. */
  const runHeadScript = () => {
    const script = document.createElement('script');
    script.textContent = SESSION_MARK_SCRIPT;
    document.head.append(script);
    script.remove();
  };

  it('is set by the head script when the browser holds a hint, and left alone when it does not', () => {
    runHeadScript();
    expect(marked()).toBe(false);
    localStorage.setItem(KEY, 'Ana');
    runHeadScript();
    expect(marked()).toBe(true);
  });

  it('is a plain, self-contained script: it reads one key, writes one attribute, and never throws', () => {
    expect(SESSION_MARK_SCRIPT).toContain(KEY);
    expect(SESSION_MARK_SCRIPT).toContain('data-session');
    // No cookie, no network and no other storage than the hint.
    for (const forbidden of [
      'cookie',
      'fetch',
      'XMLHttpRequest',
      'sessionStorage',
    ]) {
      expect(SESSION_MARK_SCRIPT).not.toContain(forbidden);
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    runHeadScript();
    expect(marked()).toBe(false);
  });

  it('follows the hint: saved marks it, erased unmarks it, in this tab and from another', () => {
    saveSessionFirstName('Rosa');
    expect(marked()).toBe(true);
    clearSessionFirstName();
    expect(marked()).toBe(false);
    const stop = subscribeSessionHint(() => undefined);
    localStorage.setItem(KEY, 'Rosa');
    globalThis.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    expect(marked()).toBe(true);
    // Another tab signs out: its storage event unmarks this one too.
    localStorage.removeItem(KEY);
    globalThis.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    expect(marked()).toBe(false);
    // An unrelated key says nothing about the session.
    localStorage.setItem(KEY, 'Rosa');
    globalThis.dispatchEvent(new StorageEvent('storage', { key: 'other' }));
    expect(marked()).toBe(false);
    stop();
  });

  it('can be set and unset directly', () => {
    markSession(true);
    expect(marked()).toBe(true);
    markSession(false);
    expect(marked()).toBe(false);
  });
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
