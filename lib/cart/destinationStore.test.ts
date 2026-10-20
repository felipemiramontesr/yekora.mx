// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'yekora_shipping_state_v1';

// Each test gets a fresh tab: a new module instance (the store is a per-tab singleton).
async function freshStore() {
  vi.resetModules();
  return (await import('./destinationStore')).getDestinationStore();
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('destination store', () => {
  it('starts with no state and remembers only the 3-letter code of the chosen one', async () => {
    const store = await freshStore();
    expect(store.getSnapshot()).toBeNull();
    store.setState('ZAC');
    expect(store.getSnapshot()).toBe('ZAC');
    expect(localStorage.getItem(KEY)).toBe('ZAC');
    // Nothing else of the cart or the buyer is written by this store.
    expect(Object.keys(localStorage)).toEqual([KEY]);
  });

  it('forgets the state with null', async () => {
    const store = await freshStore();
    store.setState('JAL');
    store.setState(null);
    expect(store.getSnapshot()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('ignores anything that is not one of the 32 states (a postal code included)', async () => {
    const store = await freshStore();
    store.setState('ZAC');
    for (const bad of ['zac', 'XYZ', '98612', '']) store.setState(bad);
    // An invalid value clears the choice instead of keeping a stale one.
    expect(store.getSnapshot()).toBeNull();
    localStorage.setItem(KEY, '98612');
    expect((await freshStore()).getSnapshot()).toBeNull();
  });

  it('restores a valid stored state on the next visit', async () => {
    localStorage.setItem(KEY, 'CMX');
    expect((await freshStore()).getSnapshot()).toBe('CMX');
  });

  it('notifies subscribers once per change and stops on unsubscribe', async () => {
    const store = await freshStore();
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    store.setState('ZAC');
    store.setState('ZAC'); // no change, no notification
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    store.setState('JAL');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('follows another tab through the storage event, and ignores other keys', async () => {
    const store = await freshStore();
    const listener = vi.fn();
    store.subscribe(listener);
    localStorage.setItem(KEY, 'ROO');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'yekora_cart_v1' })
    );
    expect(store.getSnapshot()).toBeNull();
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    expect(store.getSnapshot()).toBe('ROO');
    localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(store.getSnapshot()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('keeps the choice for the visit when storage is full', async () => {
    const store = await freshStore();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    store.setState('ZAC');
    expect(store.getSnapshot()).toBe('ZAC');
  });

  it('reads as no state when the browser refuses to read storage', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect((await freshStore()).getSnapshot()).toBeNull();
  });

  it('works in memory when localStorage itself is blocked', async () => {
    vi.spyOn(globalThis.window, 'localStorage', 'get').mockImplementation(
      () => {
        throw new DOMException('blocked', 'SecurityError');
      }
    );
    const store = await freshStore();
    expect(store.getSnapshot()).toBeNull();
    store.setState('ZAC');
    expect(store.getSnapshot()).toBe('ZAC');
  });

  it('returns the same store to every caller and is empty while prerendering', async () => {
    vi.resetModules();
    const { getDestinationStore } = await import('./destinationStore');
    expect(getDestinationStore()).toBe(getDestinationStore());
    vi.stubGlobal('window', undefined);
    vi.resetModules();
    const mod = await import('./destinationStore');
    expect(mod.getServerDestinationSnapshot()).toBeNull();
    const store = mod.getDestinationStore();
    store.setState('ZAC');
    expect(store.getSnapshot()).toBe('ZAC');
  });
});
