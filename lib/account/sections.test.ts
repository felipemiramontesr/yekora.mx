import { describe, expect, it } from 'vitest';
import { adminCardsOf, canOpen, isOwner, sectionsOf } from './sections';

describe('sections of the account area (FC 044 T1.4, FC 047)', () => {
  it('offers a buyer their orders and their data', () => {
    expect(
      sectionsOf({ roles: ['customer'], permissions: ['account:self'] })
    ).toEqual(['orders', 'profile']);
  });

  it('adds the panel and the catalog by permission, in order', () => {
    expect(
      sectionsOf({
        roles: ['staff_orders'],
        permissions: ['catalog:write', 'orders:read'],
      })
    ).toEqual(['orders', 'profile', 'admin']);
  });

  it('offers the administrators console to the owner only, never by permission', () => {
    expect(sectionsOf({ roles: ['owner'], permissions: [] })).toEqual([
      'orders',
      'profile',
      'admin',
    ]);
    expect(
      sectionsOf({ roles: ['admin'], permissions: ['admins:write'] })
    ).toEqual(['orders', 'profile']);
    expect(isOwner({ roles: ['owner'] })).toBe(true);
    expect(isOwner({ roles: ['admin'] })).toBe(false);
  });

  it('opens a console by its own privilege, whether or not the menu lists it (FC 052)', () => {
    const staff = { roles: ['staff_orders'], permissions: ['orders:read'] };
    expect(canOpen(staff, 'panel')).toBe(true);
    expect(canOpen(staff, 'catalog')).toBe(false);
    expect(canOpen(staff, 'admins')).toBe(false);
    expect(canOpen(staff, 'admin')).toBe(true);
    const buyer = { roles: ['customer'], permissions: ['account:self'] };
    for (const section of ['panel', 'catalog', 'admins', 'admin'] as const) {
      expect(canOpen(buyer, section)).toBe(false);
    }
    expect(canOpen(buyer, 'orders')).toBe(true);
    expect(canOpen(buyer, 'profile')).toBe(true);
  });

  it('gives each card of the administration hub to whoever holds its privilege and to no one else (T2.4)', () => {
    const keys = (user: Parameters<typeof adminCardsOf>[0]) =>
      adminCardsOf(user).map((card) => card.key);
    expect(keys({ roles: [], permissions: [] })).toEqual([]);
    expect(keys({ roles: [], permissions: ['orders:read'] })).toEqual([
      'orders',
    ]);
    expect(keys({ roles: [], permissions: ['catalog:write'] })).toEqual([
      'products',
      'catalog',
    ]);
    expect(keys({ roles: ['owner'], permissions: [] })).toEqual(['admins']);
    expect(
      keys({ roles: ['owner'], permissions: ['orders:read', 'catalog:write'] })
    ).toEqual(['orders', 'products', 'catalog', 'admins']);
    // Each card names the console and the tab it opens.
    expect(
      adminCardsOf({
        roles: ['owner'],
        permissions: ['orders:read', 'catalog:write'],
      })
    ).toEqual([
      { key: 'orders', tab: 'panel', section: null },
      { key: 'products', tab: 'catalog', section: 'productos' },
      { key: 'catalog', tab: 'catalog', section: 'marcas' },
      { key: 'admins', tab: 'admins', section: null },
    ]);
  });
});
