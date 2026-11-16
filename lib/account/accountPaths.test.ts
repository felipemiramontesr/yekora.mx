import { describe, expect, it } from 'vitest';
import { accountPath, parseAccountPath } from './accountPaths';

const ORDER = 'YEK-2026-AB12CD34';

describe('account area paths (FC 028 F2, T2.6c)', () => {
  it.each([
    ['/cuenta/', { tab: 'orders', orderNumber: null }],
    [`/cuenta/${ORDER}/`, { tab: 'orders', orderNumber: ORDER }],
    ['/cuenta/datos/', { tab: 'profile', orderNumber: null }],
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
      { tab: 'profile', orderNumber: null },
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

describe('administration paths (FC 052 T1.1)', () => {
  it('reads and writes /administracion/ in both languages', () => {
    for (const area of ['/cuenta/', '/en/account/']) {
      expect(parseAccountPath(`${area}administracion/`, area)).toEqual({
        tab: 'admin',
        orderNumber: null,
      });
      expect(accountPath(area, { tab: 'admin', orderNumber: null })).toBe(
        `${area}administracion/`
      );
    }
  });

  it.each([['productos'], ['marcas'], ['propiedades'], ['publicar']] as const)(
    'gives the %s tab of the catalog console its own address',
    (section) => {
      for (const area of ['/cuenta/', '/en/account/']) {
        const view = { tab: 'catalog', orderNumber: null, section } as const;
        expect(accountPath(area, view)).toBe(`${area}catalogo/${section}/`);
        expect(parseAccountPath(`${area}catalogo/${section}/`, area)).toEqual(
          view
        );
      }
    }
  );
});

describe('data and addresses path (FC 051)', () => {
  it('reads and writes /datos/ in both languages, with no order in it', () => {
    for (const area of ['/cuenta/', '/en/account/']) {
      expect(parseAccountPath(`${area}datos/`, area)).toEqual({
        tab: 'profile',
        orderNumber: null,
      });
      expect(accountPath(area, { tab: 'profile', orderNumber: null })).toBe(
        `${area}datos/`
      );
    }
  });
});

describe('catalog console path (FC 029 F3)', () => {
  it('reads and writes /catalogo/ in both languages, whatever follows it', () => {
    for (const area of ['/cuenta/', '/en/account/']) {
      expect(parseAccountPath(`${area}catalogo/`, area)).toEqual({
        tab: 'catalog',
        orderNumber: null,
        section: null,
      });
      expect(parseAccountPath(`${area}catalogo/otra-cosa/`, area)).toEqual({
        tab: 'catalog',
        orderNumber: null,
        section: null,
      });
      expect(accountPath(area, { tab: 'catalog', orderNumber: null })).toBe(
        `${area}catalogo/`
      );
    }
  });
});

describe('administrators console path (FC 044 F2)', () => {
  it('reads and writes /administradores/ in both languages, whatever follows it', () => {
    for (const area of ['/cuenta/', '/en/account/']) {
      expect(parseAccountPath(`${area}administradores/`, area)).toEqual({
        tab: 'admins',
        orderNumber: null,
      });
      expect(parseAccountPath(`${area}administradores/x/`, area).tab).toBe(
        'admins'
      );
      expect(accountPath(area, { tab: 'admins', orderNumber: null })).toBe(
        `${area}administradores/`
      );
    }
  });
});
