import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACCOUNT_SEGMENTS,
  accountPath,
  CATALOG_SECTIONS,
  parseAccountPath,
} from './accountPaths';

const ORDER = 'YEK-2026-AB12CD34';

describe('account area paths (FC 028 F2, T2.6c)', () => {
  it.each([
    ['/cuenta/', { tab: 'orders', orderNumber: null }],
    [`/cuenta/${ORDER}/`, { tab: 'orders', orderNumber: ORDER }],
    ['/cuenta/datos/', { tab: 'profile', orderNumber: null }],
    ['/cuenta/metodos-pago/', { tab: 'payment-methods', orderNumber: null }],
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
      { tab: 'payment-methods', orderNumber: null },
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

describe('saved cards path (FC 054 F1)', () => {
  it('reads and writes /metodos-pago/ in both languages, with no order in it', () => {
    for (const area of ['/cuenta/', '/en/account/']) {
      expect(parseAccountPath(`${area}metodos-pago/`, area)).toEqual({
        tab: 'payment-methods',
        orderNumber: null,
      });
      expect(
        accountPath(area, { tab: 'payment-methods', orderNumber: null })
      ).toBe(`${area}metodos-pago/`);
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
  it('reads and writes /usuarios/ in both languages, whatever follows it', () => {
    for (const area of ['/cuenta/', '/en/account/']) {
      expect(parseAccountPath(`${area}usuarios/`, area)).toEqual({
        tab: 'users',
        orderNumber: null,
      });
      expect(parseAccountPath(`${area}usuarios/x/`, area).tab).toBe('users');
      expect(accountPath(area, { tab: 'users', orderNumber: null })).toBe(
        `${area}usuarios/`
      );
    }
  });
});

describe('board of returns path (FC 073)', () => {
  it('reads and writes /devoluciones/ the same in both languages, whatever follows it', () => {
    for (const area of ['/cuenta/', '/en/account/']) {
      expect(parseAccountPath(`${area}devoluciones/`, area)).toEqual({
        tab: 'returns',
        orderNumber: null,
      });
      expect(parseAccountPath(`${area}devoluciones/x/`, area).tab).toBe(
        'returns'
      );
      expect(accountPath(area, { tab: 'returns', orderNumber: null })).toBe(
        `${area}devoluciones/`
      );
    }
  });
});

describe('shipping console path (FC 061)', () => {
  it('reads and writes /envios/ the same in both languages, whatever follows it', () => {
    for (const area of ['/cuenta/', '/en/account/']) {
      expect(parseAccountPath(`${area}envios/`, area)).toEqual({
        tab: 'shipping',
        orderNumber: null,
      });
      expect(parseAccountPath(`${area}envios/x/`, area).tab).toBe('shipping');
      expect(accountPath(area, { tab: 'shipping', orderNumber: null })).toBe(
        `${area}envios/`
      );
    }
  });
});

describe('the address table of the area (FC 074 K-77, T2.4, T2.5)', () => {
  it('names one fixed segment for each tab but the orders, and the four tabs of the catalog', () => {
    expect(ACCOUNT_SEGMENTS).toEqual({
      profile: 'datos',
      'payment-methods': 'metodos-pago',
      admin: 'administracion',
      panel: 'panel',
      catalog: 'catalogo',
      users: 'usuarios',
      returns: 'devoluciones',
      shipping: 'envios',
      pos: 'pos',
    });
    expect(CATALOG_SECTIONS).toEqual([
      'productos',
      'marcas',
      'propiedades',
      'publicar',
    ]);
  });

  it('writes every tab at its segment and reads it back, in both languages', () => {
    for (const area of ['/cuenta/', '/en/account/']) {
      for (const [tab, segment] of Object.entries(ACCOUNT_SEGMENTS)) {
        const view = { tab, orderNumber: null } as Parameters<
          typeof accountPath
        >[1];
        expect(accountPath(area, view)).toBe(`${area}${segment}/`);
        expect(parseAccountPath(`${area}${segment}/`, area).tab).toBe(tab);
      }
    }
  });

  it('keeps no address of the retired «administradores» console in the code of the account area', () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? files(path) : [path];
      });
    const here = 'accountPaths.test.ts';
    for (const dir of ['lib/account', 'components/account']) {
      for (const file of files(dir).filter((path) => !path.endsWith(here))) {
        expect(readFileSync(file, 'utf8')).not.toMatch(/administradores\//);
      }
    }
  });
});
