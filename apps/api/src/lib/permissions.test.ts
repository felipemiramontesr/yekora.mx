import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isPrivileged, PERMISSIONS } from './permissions';

const migrations = fileURLToPath(
  new URL('../../../../migrations/', import.meta.url)
);
const migration = (number: string) =>
  readFileSync(
    migrations +
      readdirSync(migrations).find((name) => name.startsWith(`${number}_V`)),
    'utf8'
  );
const migration004 = migration('004');
const migration008 = migration('008');
const migration014 = migration('014');
const migration016 = migration('016');
const migration017 = migration('017');
const migration018 = migration('018');
const migration020 = migration('020');

describe('permission catalog (FC 028)', () => {
  it('names exactly the permissions migration 004 seeds, so code and database never drift', () => {
    const block = migration004.slice(
      migration004.indexOf('INSERT IGNORE INTO permissions'),
      migration004.indexOf('INSERT IGNORE INTO role_permissions')
    );
    const seeded = [...block.matchAll(/\('([a-z]+:[a-z_]+)'/g)].map(
      (m) => m[1]
    );
    // FC 061: migration 014 opens `shipping:manage` and grants it to owner and admin by name,
    // because 004 and 008 ran before it existed.
    expect(seeded.sort()).toEqual(
      PERMISSIONS.filter(
        (permission) =>
          permission !== 'shipping:manage' &&
          permission !== 'orders:manage' &&
          !permission.startsWith('returns:') &&
          permission !== 'roles:manage' &&
          permission !== 'sellers:manage' &&
          !permission.startsWith('pos:')
      ).sort()
    );
  });

  it('opens the three pos:* in migration 020: sell and shift for staff_orders, supervisor for owner and admin (FC 076 T0.1)', () => {
    for (const id of ['pos:sell', 'pos:shift', 'pos:supervisor']) {
      expect(migration020).toContain(`('${id}', 'pos', `);
    }
    expect(migration020).toMatch(
      /p\.id IN \('pos:sell', 'pos:shift'\)\s+WHERE r\.id IN \('owner', 'admin', 'staff_orders'\)/
    );
    expect(migration020).toMatch(
      /SELECT r\.id, 'pos:supervisor' FROM roles r WHERE r\.id IN \('owner', 'admin'\)/
    );
    expect(PERMISSIONS).toEqual(
      expect.arrayContaining(['pos:sell', 'pos:shift', 'pos:supervisor'])
    );
  });

  it('opens orders:manage in migration 016 and grants it to owner, admin and staff_orders (FC 068 T0.1)', () => {
    expect(migration016).toMatch(
      /INSERT IGNORE INTO permissions \(id, module, description\) VALUES\s+\('orders:manage', 'orders'/
    );
    expect(migration016).toMatch(
      /SELECT r\.id, 'orders:manage' FROM roles r WHERE r\.id IN \('owner', 'admin', 'staff_orders'\)/
    );
    expect(PERMISSIONS).toContain('orders:manage');
  });

  it('opens roles:manage for the owner alone and sellers:manage for owner and admin in migration 018 (FC 072 T0.1)', () => {
    expect(migration018).toContain("('roles:manage', 'roles', ");
    expect(migration018).toContain("('sellers:manage', 'users', ");
    // The owner takes every permission with the union of 008; the admin takes only sellers:manage.
    expect(migration018).toMatch(/SELECT 'owner', id FROM permissions;/);
    expect(migration018).toContain("('admin', 'sellers:manage')");
    expect(migration018).not.toContain("('admin', 'roles:manage')");
    expect(PERMISSIONS).toEqual(
      expect.arrayContaining(['roles:manage', 'sellers:manage'])
    );
  });

  it('opens the three returns permissions in migration 017: view and prepare for owner, admin and staff_orders, confirm for owner and admin (FC 071 T0.1)', () => {
    for (const id of ['returns:view', 'returns:prepare', 'returns:confirm']) {
      expect(migration017).toContain(`('${id}', 'returns', `);
    }
    expect(migration017).toMatch(
      /p\.id IN \('returns:view', 'returns:prepare'\)\s+WHERE r\.id IN \('owner', 'admin', 'staff_orders'\)/
    );
    expect(migration017).toMatch(
      /SELECT r\.id, 'returns:confirm' FROM roles r WHERE r\.id IN \('owner', 'admin'\)/
    );
    expect(PERMISSIONS).toEqual(
      expect.arrayContaining([
        'returns:view',
        'returns:prepare',
        'returns:confirm',
      ])
    );
  });

  it('opens shipping:manage in migration 014 and grants it to owner and admin (FC 061 T0.1)', () => {
    expect(migration014).toMatch(
      /INSERT IGNORE INTO permissions \(id, module, description\) VALUES\s+\('shipping:manage', 'shipping'/
    );
    expect(migration014).toMatch(
      /SELECT r\.id, 'shipping:manage' FROM roles r WHERE r\.id IN \('owner', 'admin'\)/
    );
    expect(PERMISSIONS).toContain('shipping:manage');
  });

  it('gives admin the union of every permission by construction, never a hand-kept list (T2.3b)', () => {
    // One INSERT … SELECT over the whole catalog: a permission added later reaches admin too.
    expect(migration004).toMatch(
      /INSERT IGNORE INTO role_permissions \(role_id, permission_id\)\s+SELECT 'admin', id FROM permissions;/
    );
    expect(migration004).not.toMatch(/\('admin', '[a-z]+:[a-z_]+'\)/);
  });

  it('seeds owner active and gives it the union of every permission by construction (FC 044 T0.1)', () => {
    expect(migration008).toMatch(
      /INSERT IGNORE INTO roles \(id, name, description\) VALUES\s+\('owner', 'Dueño', /
    );
    expect(migration008).toMatch(
      /INSERT IGNORE INTO role_permissions \(role_id, permission_id\)\s+SELECT 'owner', id FROM permissions;/
    );
    expect(migration008).not.toMatch(/\('owner', '[a-z]+:[a-z_]+'\)/);
  });

  it('treats every role but customer as privileged (TOTP mandatory)', () => {
    expect(isPrivileged(['customer'])).toBe(false);
    expect(isPrivileged([])).toBe(false);
    expect(isPrivileged(['customer', 'staff_orders'])).toBe(true);
    expect(isPrivileged(['admin'])).toBe(true);
    // FC 044 T2.4: the owner too, so no remembered device and the authenticator is mandatory.
    expect(isPrivileged(['owner'])).toBe(true);
  });
});
