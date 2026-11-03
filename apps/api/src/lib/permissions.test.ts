import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isPrivileged, PERMISSIONS } from './permissions';

const migrations = fileURLToPath(
  new URL('../../../../migrations/', import.meta.url)
);
const migration004 = readFileSync(
  migrations +
    readdirSync(migrations).find((name) => /^004_V.+\.sql$/.test(name)),
  'utf8'
);

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

  it('treats every role but customer as privileged (TOTP mandatory)', () => {
    expect(isPrivileged(['customer'])).toBe(false);
    expect(isPrivileged([])).toBe(false);
    expect(isPrivileged(['customer', 'staff_orders'])).toBe(true);
    expect(isPrivileged(['admin'])).toBe(true);
  });
});
