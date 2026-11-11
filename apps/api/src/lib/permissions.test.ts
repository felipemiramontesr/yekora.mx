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

describe('permission catalog (FC 028)', () => {
  it('names exactly the permissions migration 004 seeds, so code and database never drift', () => {
    const block = migration004.slice(
      migration004.indexOf('INSERT IGNORE INTO permissions'),
      migration004.indexOf('INSERT IGNORE INTO role_permissions')
    );
    const seeded = [...block.matchAll(/\('([a-z]+:[a-z_]+)'/g)].map(
      (m) => m[1]
    );
    expect(seeded.sort()).toEqual([...PERMISSIONS].sort());
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
