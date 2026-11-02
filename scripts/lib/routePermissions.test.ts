import { describe, expect, it } from 'vitest';
import { ROUTE_CONTRACTS } from '../../apps/api/src/contract';
import { routePermissionViolations } from './routePermissions';

describe('routePermissionViolations (FC 027 T2.6, S02)', () => {
  it('the API contract of today maps every route to a known permission', () => {
    expect(routePermissionViolations(ROUTE_CONTRACTS, [])).toEqual([]);
  });

  it('refuses a private route declared public, under either prefix', () => {
    expect(
      routePermissionViolations(
        [
          { method: 'GET', path: '/v1/account/orders', permission: 'public' },
          { method: 'GET', path: '/v1/admin', permission: 'public' },
        ],
        []
      )
    ).toEqual([
      'GET /v1/account/orders: private route declared public',
      'GET /v1/admin: private route declared public',
    ]);
  });

  it('accepts a private route guarded by a permission of the catalog', () => {
    expect(
      routePermissionViolations(
        [
          {
            method: 'GET',
            path: '/v1/admin/orders',
            permission: 'orders.read',
          },
        ],
        ['orders.read']
      )
    ).toEqual([]);
  });

  it('refuses a permission that is not in the catalog', () => {
    expect(
      routePermissionViolations(
        [
          {
            method: 'GET',
            path: '/v1/admin/orders',
            permission: 'orders.raed',
          },
        ],
        ['orders.read']
      )
    ).toEqual(['GET /v1/admin/orders: unknown permission "orders.raed"']);
  });

  it('refuses the same route declared twice', () => {
    const route = { method: 'GET', path: '/v1/catalog', permission: 'public' };
    expect(routePermissionViolations([route, route], [])).toEqual([
      'GET /v1/catalog: declared twice',
    ]);
  });

  it('does not mistake a public path that only starts like a private prefix', () => {
    expect(
      routePermissionViolations(
        [
          {
            method: 'GET',
            path: '/v1/administrators-guide',
            permission: 'public',
          },
        ],
        []
      )
    ).toEqual([]);
  });
});
