// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CART_STORAGE_KEY } from './cartTypes';

// Each test gets a fresh tab: a new module instance (the store is a per-tab singleton).
async function freshStore() {
  vi.resetModules();
  return (await import('./cartStore')).getCartStore();
}

const stored = () =>
  JSON.parse(localStorage.getItem(CART_STORAGE_KEY) ?? 'null');

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('cart store', () => {
  it('starts empty and stores only SKU and quantity (T1.4, no personal data)', async () => {
    const cart = await freshStore();
    expect(cart.getSnapshot()).toEqual([]);
    expect(cart.addItem('TENT', 2)).toBe(true);
    expect(stored()).toEqual([{ sku: 'TENT', quantity: 2 }]);
    expect(Object.keys(stored()[0])).toEqual(['sku', 'quantity']);
  });

  it('merges a product into its line and caps it at 99', async () => {
    const cart = await freshStore();
    cart.addItem('TENT');
    cart.addItem('TENT', 3);
    expect(cart.getSnapshot()).toEqual([{ sku: 'TENT', quantity: 4 }]);
    expect(cart.addItem('TENT', 500)).toBe(true);
    expect(cart.getSnapshot()).toEqual([{ sku: 'TENT', quantity: 99 }]);
    expect(cart.addItem('TENT')).toBe(false);
    expect(cart.addItem('NEW', 120)).toBe(true);
    expect(cart.getSnapshot()[1]).toEqual({ sku: 'NEW', quantity: 99 });
  });

  it.each([
    ['an empty SKU', '', 1],
    ['a SKU over 64 characters', 'X'.repeat(65), 1],
    ['a zero quantity', 'TENT', 0],
    ['a non-number quantity', 'TENT', Number.NaN],
    ['an infinite quantity', 'TENT', Number.POSITIVE_INFINITY],
  ])('refuses %s', async (_case, sku, quantity) => {
    const cart = await freshStore();
    expect(cart.addItem(sku, quantity)).toBe(false);
    expect(cart.getSnapshot()).toEqual([]);
  });

  it('adds to one line without touching the others', async () => {
    const cart = await freshStore();
    cart.addItem('A');
    cart.addItem('B');
    cart.addItem('A', 2);
    expect(cart.getSnapshot()).toEqual([
      { sku: 'A', quantity: 3 },
      { sku: 'B', quantity: 1 },
    ]);
  });

  it('holds at most 50 distinct products', async () => {
    const cart = await freshStore();
    for (let i = 0; i < 50; i++) expect(cart.addItem(`P${i}`)).toBe(true);
    expect(cart.addItem('P50')).toBe(false);
    expect(cart.getSnapshot()).toHaveLength(50);
  });

  it('updates, caps and removes quantities', async () => {
    const cart = await freshStore();
    cart.addItem('A', 2);
    cart.addItem('B', 1);
    cart.updateQuantity('A', 5.7);
    expect(cart.getSnapshot()[0]).toEqual({ sku: 'A', quantity: 5 });
    cart.updateQuantity('A', 400);
    expect(cart.getSnapshot()[0].quantity).toBe(99);
    cart.updateQuantity('A', Number.NaN);
    cart.updateQuantity('A', Number.POSITIVE_INFINITY);
    expect(cart.getSnapshot()[0].quantity).toBe(99);
    cart.updateQuantity('A', 0);
    expect(cart.getSnapshot()).toEqual([{ sku: 'B', quantity: 1 }]);
    cart.updateQuantity('GHOST', 3);
    cart.removeItem('GHOST');
    cart.removeItem('B');
    expect(cart.getSnapshot()).toEqual([]);
    expect(localStorage.getItem(CART_STORAGE_KEY)).toBeNull();
  });

  it('keeps the same snapshot and stays silent when nothing changes', async () => {
    const cart = await freshStore();
    cart.addItem('A', 2);
    const listener = vi.fn();
    const stop = cart.subscribe(listener);
    const before = cart.getSnapshot();
    cart.updateQuantity('A', 2);
    cart.removeItem('GHOST');
    expect(cart.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    cart.addItem('B');
    expect(listener).toHaveBeenCalledOnce();
    expect(Object.isFrozen(cart.getSnapshot())).toBe(true);
    stop();
    cart.clearCart();
    cart.clearCart();
    expect(listener).toHaveBeenCalledOnce();
  });

  it('restores the cart of a previous visit', async () => {
    localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify([{ sku: 'TENT', quantity: 3 }])
    );
    expect((await freshStore()).getSnapshot()).toEqual([
      { sku: 'TENT', quantity: 3 },
    ]);
  });

  it.each([
    ['not JSON', '{oops'],
    [
      'a price smuggled in',
      JSON.stringify([{ sku: 'A', quantity: 1, price: 1 }]),
    ],
    [
      'a repeated SKU',
      JSON.stringify([
        { sku: 'A', quantity: 1 },
        { sku: 'A', quantity: 2 },
      ]),
    ],
    ['a quantity of 1000', JSON.stringify([{ sku: 'A', quantity: 1000 }])],
    ['an object instead of a list', JSON.stringify({ sku: 'A' })],
  ])('ignores a stored cart that is %s', async (_case, raw) => {
    localStorage.setItem(CART_STORAGE_KEY, raw);
    expect((await freshStore()).getSnapshot()).toEqual([]);
  });

  it('follows changes made in another tab, and a cleared storage', async () => {
    const cart = await freshStore();
    const listener = vi.fn();
    cart.subscribe(listener);
    localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify([{ sku: 'X', quantity: 2 }])
    );
    globalThis.dispatchEvent(
      new StorageEvent('storage', { key: CART_STORAGE_KEY })
    );
    expect(cart.getSnapshot()).toEqual([{ sku: 'X', quantity: 2 }]);
    globalThis.dispatchEvent(new StorageEvent('storage', { key: 'other_key' }));
    expect(listener).toHaveBeenCalledOnce();
    localStorage.clear();
    globalThis.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(cart.getSnapshot()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('keeps working in memory when the browser refuses to store (quota, privacy mode)', async () => {
    const cart = await freshStore();
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('full', 'QuotaExceededError');
      });
    expect(cart.addItem('TENT')).toBe(true);
    expect(cart.getSnapshot()).toEqual([{ sku: 'TENT', quantity: 1 }]);
    setItem.mockRestore();
  });

  it('works in memory when localStorage itself is blocked', async () => {
    vi.spyOn(globalThis.window, 'localStorage', 'get').mockImplementation(
      () => {
        throw new DOMException('blocked', 'SecurityError');
      }
    );
    const cart = await freshStore();
    expect(cart.addItem('TENT')).toBe(true);
    expect(cart.getSnapshot()).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it('returns the same cart to every caller of the tab', async () => {
    vi.resetModules();
    const { getCartStore } = await import('./cartStore');
    expect(getCartStore()).toBe(getCartStore());
  });

  it('is an empty in-memory cart while prerendering, without a window', async () => {
    vi.stubGlobal('window', undefined);
    vi.resetModules();
    const { getCartStore, getServerCartSnapshot } = await import('./cartStore');
    expect(getServerCartSnapshot()).toEqual([]);
    const cart = getCartStore();
    expect(cart.getSnapshot()).toEqual([]);
    expect(cart.addItem('TENT')).toBe(true);
  });
});
