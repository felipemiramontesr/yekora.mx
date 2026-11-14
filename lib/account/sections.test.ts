import { describe, expect, it } from 'vitest';
import { isOwner, sectionsOf } from './sections';

describe('sections of the account area (FC 044 T1.4, FC 047)', () => {
  it('offers a buyer only their orders', () => {
    expect(
      sectionsOf({ roles: ['customer'], permissions: ['account:self'] })
    ).toEqual(['orders']);
  });

  it('adds the panel and the catalog by permission, in order', () => {
    expect(
      sectionsOf({
        roles: ['staff_orders'],
        permissions: ['catalog:write', 'orders:read'],
      })
    ).toEqual(['orders', 'panel', 'catalog']);
  });

  it('offers the administrators console to the owner only, never by permission', () => {
    expect(sectionsOf({ roles: ['owner'], permissions: [] })).toEqual([
      'orders',
      'admins',
    ]);
    expect(
      sectionsOf({ roles: ['admin'], permissions: ['admins:write'] })
    ).toEqual(['orders']);
    expect(isOwner({ roles: ['owner'] })).toBe(true);
    expect(isOwner({ roles: ['admin'] })).toBe(false);
  });
});
