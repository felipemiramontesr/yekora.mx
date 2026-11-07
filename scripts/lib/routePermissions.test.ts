import { describe, expect, it } from 'vitest';
import { ROUTE_CONTRACTS } from '../../apps/api/src/contract';
import { PERMISSIONS } from '../../apps/api/src/lib/permissions';
import { routePermissionViolations } from './routePermissions';

describe('routePermissionViolations (FC 027 T2.6, S02)', () => {
  it('the API contract of today maps every route to a known permission', () => {
    expect(routePermissionViolations(ROUTE_CONTRACTS, PERMISSIONS)).toEqual([]);
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

  it('allows a private path to be public only for a 405 refusal (T2.6a)', () => {
    const refusal = { 405: {} };
    expect(
      routePermissionViolations(
        [
          {
            method: 'POST',
            path: '/v1/account/orders',
            permission: 'public',
            responses: refusal,
          },
          {
            method: 'PATCH',
            path: '/v1/admin/orders',
            permission: 'public',
            responses: { 200: {}, 405: {} },
          },
        ],
        []
      )
    ).toEqual(['PATCH /v1/admin/orders: private route declared public']);
  });

  it('refuses a panel route behind the buyer’s own permission (T2.3a)', () => {
    expect(
      routePermissionViolations(
        [
          {
            method: 'GET',
            path: '/v1/admin/orders',
            permission: 'account:self',
          },
        ],
        ['account:self']
      )
    ).toEqual([
      'GET /v1/admin/orders: panel route without a granular permission',
    ]);
  });

  it('refuses a DELETE that would do anything but refuse (T2.3c)', () => {
    expect(
      routePermissionViolations(
        [
          {
            method: 'DELETE',
            path: '/v1/admin/users/:id',
            permission: 'users:manage',
            responses: { 204: {} },
          },
          {
            method: 'DELETE',
            path: '/v1/admin/orders',
            permission: 'public',
            responses: { 405: {} },
          },
        ],
        ['users:manage']
      )
    ).toEqual(['DELETE /v1/admin/users/:id: DELETE must only refuse (405)']);
  });

  it('lets a guarded DELETE carry the guard refusals before its 405, never anything else (FC 029 T1.1)', () => {
    const guarded = (responses: Record<number, unknown>) => ({
      method: 'DELETE',
      path: '/v1/admin/catalog/*',
      permission: 'catalog:write',
      responses,
    });
    expect(
      routePermissionViolations(
        [guarded({ 405: {}, 401: {}, 403: {}, 503: {} })],
        ['catalog:write']
      )
    ).toEqual([]);
    expect(
      routePermissionViolations(
        [guarded({ 401: {}, 403: {} })],
        ['catalog:write']
      )
    ).toEqual(['DELETE /v1/admin/catalog/*: DELETE must only refuse (405)']);
    expect(
      routePermissionViolations(
        [guarded({ 405: {}, 200: {} })],
        ['catalog:write']
      )
    ).toEqual(['DELETE /v1/admin/catalog/*: DELETE must only refuse (405)']);
  });

  it('treats a DELETE without declared answers as one that may do anything', () => {
    expect(
      routePermissionViolations(
        [{ method: 'DELETE', path: '/v1/things', permission: 'public' }],
        []
      )
    ).toEqual(['DELETE /v1/things: DELETE must only refuse (405)']);
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
