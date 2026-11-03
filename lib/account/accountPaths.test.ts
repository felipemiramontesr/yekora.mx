import { describe, expect, it } from 'vitest';
import { accountPath, parseAccountPath } from './accountPaths';

const ORDER = 'YEK-2026-AB12CD34';

describe('account area paths (FC 028 F2, T2.6c)', () => {
  it.each([
    ['/cuenta/', { tab: 'orders', orderNumber: null }],
    [`/cuenta/${ORDER}/`, { tab: 'orders', orderNumber: ORDER }],
    ['/cuenta/panel/', { tab: 'panel', orderNumber: null }],
    [`/cuenta/panel/${ORDER}/`, { tab: 'panel', orderNumber: ORDER }],
    ['/cuenta/panel/not-an-order/', { tab: 'panel', orderNumber: null }],
    ['/cuenta/anything/else/', { tab: 'orders', orderNumber: null }],
    ['/catalogo/', { tab: 'orders', orderNumber: null }],
  ])('reads %s', (path, view) => {
    expect(parseAccountPath(path, '/cuenta/')).toEqual(view);
  });

  it('writes each view back to the path it was read from', () => {
    for (const view of [
      { tab: 'orders', orderNumber: null },
      { tab: 'orders', orderNumber: ORDER },
      { tab: 'panel', orderNumber: null },
      { tab: 'panel', orderNumber: ORDER },
    ] as const) {
      const path = accountPath('/en/account/', view);
      expect(parseAccountPath(path, '/en/account/')).toEqual(view);
    }
    expect(accountPath('/cuenta/', { tab: 'panel', orderNumber: ORDER })).toBe(
      `/cuenta/panel/${ORDER}/`
    );
  });
});
