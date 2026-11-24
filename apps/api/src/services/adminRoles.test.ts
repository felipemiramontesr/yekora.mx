/**
 * FC 072 F1 evidence of the roles and the matrix: the 16 rows of T1.2, the owner alone as editor,
 * the system roles that stay as they are, the invariants of the matrix (T2.7) and the audit (T2.5).
 */
import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '../lib/permissions';
import { createRole, listRoles, patchRole } from './adminRoles';
import type { TxQuery } from './db';
import { decideRoleMutation } from './staffGates';

const OWNER = {
  userId: 'owner-1',
  roles: ['owner', 'customer'],
  permissions: ['account:self', 'roles:manage', 'sellers:manage'],
  totpEnabled: true,
  ip: '203.0.113.9',
};
const ADMIN = {
  userId: 'admin-1',
  roles: ['admin', 'customer'],
  permissions: ['account:self', 'sellers:manage'],
  totpEnabled: true,
  ip: '203.0.113.10',
};

/** What the fake database answers. */
interface Scenario {
  taken: boolean;
  system: number | null;
  row: Record<string, unknown>;
  list: Record<string, unknown>[];
}

function fakeDb(over: Partial<Scenario> = {}) {
  const s: Scenario = {
    taken: false,
    system: 0,
    row: {
      id: 'bodega',
      name: 'Bodega',
      description: null,
      is_active: 1,
      is_system: 0,
      assignable_by_admin: 1,
      permissions: 'account:self,orders:read',
    },
    list: [],
    ...over,
  };
  const log: { sql: string; params: readonly unknown[] }[] = [];
  async function query<Row>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<Row[]> {
    log.push({ sql, params });
    if (sql.startsWith('SELECT id FROM roles WHERE id = ?')) {
      return (s.taken ? [{ id: 'bodega' }] : []) as Row[];
    }
    if (sql.startsWith('SELECT is_system FROM roles')) {
      return (s.system === null ? [] : [{ is_system: s.system }]) as Row[];
    }
    if (sql.startsWith('SELECT r.id, r.name') && params.length === 0) {
      return s.list as Row[];
    }
    if (sql.startsWith('SELECT r.id, r.name')) return [s.row] as Row[];
    return { affectedRows: 1 } as unknown as Row[];
  }
  const db: TxQuery = { query };
  const wrote = (opening: string) =>
    log.filter((entry) => entry.sql.startsWith(opening));
  return { db, wrote };
}

describe('T1.2 · RoleAndPermissionMatrixGate(O, M, S, V), the 16 rows', () => {
  const ROWS = Array.from({ length: 16 }, (_unused, index) => {
    const [owner, manager, notSystem, valid] = [3, 2, 1, 0].map(
      (shift) => ((index >> shift) & 1) === 0
    );
    let code = 'ROLE_MUTATION_PERMITTED_200';
    if (!owner || !manager) code = 'OWNER_ONLY_FORBIDDEN_403';
    else if (!notSystem) code = 'SYSTEM_ROLE_PROTECTED_403';
    else if (!valid) code = 'TWO_FACTOR_REQUIRED_403';
    return {
      label: [owner, manager, notSystem, valid]
        .map((bit) => (bit ? '⊤' : '⊥'))
        .join(''),
      inputs: { owner, manager, notSystem, valid },
      code,
    };
  });

  it.each(ROWS)('$label → $code', ({ inputs, code }) => {
    expect(decideRoleMutation(inputs)).toBe(code);
  });

  it('permits in exactly one row', () => {
    expect(
      ROWS.filter((row) => row.code === 'ROLE_MUTATION_PERMITTED_200')
    ).toHaveLength(1);
  });
});

describe('listRoles', () => {
  it('lists the roles with their permissions, and the catalog the matrix is made of', async () => {
    const { db } = fakeDb({
      list: [
        {
          id: 'owner',
          name: 'Dueño',
          description: 'Todo',
          is_active: '1',
          is_system: '1',
          assignable_by_admin: '0',
          permissions: 'account:self,roles:manage',
        },
        {
          id: 'empty',
          name: 'Vacío',
          description: null,
          is_active: 0,
          is_system: 0,
          assignable_by_admin: 1,
          permissions: null,
        },
      ],
    });
    const { items, catalog } = await listRoles(db);
    expect(items[0]).toEqual({
      id: 'owner',
      name: 'Dueño',
      description: 'Todo',
      isActive: true,
      isSystem: true,
      assignableByAdmin: false,
      permissions: ['account:self', 'roles:manage'],
    });
    expect(items[1]).toMatchObject({ isActive: false, permissions: [] });
    expect(catalog).toEqual([...PERMISSIONS].sort());
  });
});

describe('createRole', () => {
  const NEW = {
    id: 'bodega',
    name: 'Bodega',
    permissions: ['account:self', 'orders:read'],
    assignableByAdmin: true,
  };
  const create = (
    input: Partial<typeof NEW> & { description?: string },
    actor: typeof OWNER = OWNER,
    over: Partial<Scenario> = {}
  ) => {
    const harness = fakeDb(over);
    return {
      harness,
      result: createRole(harness.db, { ...NEW, ...input }, actor),
    };
  };

  it('lets the owner create a role of support with its matrix and audits it', async () => {
    const { harness, result } = create({ description: 'Almacén' });
    await expect(result).resolves.toMatchObject({ id: 'bodega' });
    expect(harness.wrote('INSERT INTO roles')[0].params).toEqual([
      'bodega',
      'Bodega',
      'Almacén',
      1,
    ]);
    expect(harness.wrote('INSERT INTO role_permissions')[0].params).toEqual([
      [
        ['bodega', 'account:self'],
        ['bodega', 'orders:read'],
      ],
    ]);
    expect(harness.wrote('INSERT INTO audit_log')[0].params).toContain(
      'ROLE_CREATED'
    );
  });

  it('records a role that an administrator may not give, and no description as nothing', async () => {
    const { harness } = create({ assignableByAdmin: false });
    await createRole(harness.db, { ...NEW, assignableByAdmin: false }, OWNER);
    expect(harness.wrote('INSERT INTO roles')[0].params).toEqual([
      'bodega',
      'Bodega',
      null,
      0,
    ]);
  });

  it('refuses everyone but the owner: an administrator, and an owner without the permission', async () => {
    await expect(create({}, ADMIN).result).resolves.toBe(
      'OWNER_ONLY_FORBIDDEN'
    );
    await expect(
      create({}, { ...OWNER, permissions: ['account:self'] }).result
    ).resolves.toBe('OWNER_ONLY_FORBIDDEN');
  });

  it('asks for the second factor of the session', async () => {
    await expect(
      create({}, { ...OWNER, totpEnabled: false }).result
    ).resolves.toBe('TWO_FACTOR_REQUIRED');
  });

  it.each(['owner', 'admin', 'customer', 'staff_orders', 'staff_catalog'])(
    'refuses the slug %s, which belongs to the system',
    async (id) => {
      await expect(create({ id }).result).resolves.toBe('ROLE_ID_RESERVED');
    }
  );

  it('refuses a slug that is taken', async () => {
    await expect(create({}, OWNER, { taken: true }).result).resolves.toBe(
      'ROLE_ALREADY_EXISTS'
    );
  });

  it.each([
    ['gives roles:manage', ['account:self', 'roles:manage']],
    [
      'gives users:manage to a role that is not the administrator',
      ['account:self', 'users:manage'],
    ],
    ['leaves out account:self', ['orders:read']],
    ['names a permission outside the catalog', ['account:self', 'ghost:power']],
  ])('refuses a matrix that %s (T2.7)', async (_name, permissions) => {
    const { harness, result } = create({ permissions });
    await expect(result).resolves.toBe('MATRIX_INVARIANT_VIOLATED');
    expect(harness.wrote('INSERT')).toEqual([]);
  });
});

describe('patchRole', () => {
  const patch = (
    id: string,
    input: Parameters<typeof patchRole>[2],
    actor: typeof OWNER = OWNER,
    over: Partial<Scenario> = {}
  ) => {
    const harness = fakeDb(over);
    return { harness, result: patchRole(harness.db, id, input, actor) };
  };

  it('edits the name, the state and the matrix of a role, and audits before and after', async () => {
    const { harness, result } = patch('bodega', {
      name: 'Bodega y envíos',
      description: 'Nuevo',
      isActive: false,
      assignableByAdmin: false,
      permissions: ['account:self', 'orders:manage'],
    });
    await expect(result).resolves.toMatchObject({ id: 'bodega' });
    expect(harness.wrote('UPDATE roles')[0].params).toEqual([
      'Bodega y envíos',
      'Nuevo',
      0,
      0,
      'bodega',
    ]);
    expect(harness.wrote('DELETE FROM role_permissions')).toHaveLength(1);
    expect(harness.wrote('INSERT INTO role_permissions')).toHaveLength(1);
    expect(harness.wrote('INSERT INTO audit_log')[0].params).toContain(
      'ROLE_UPDATED'
    );
  });

  it('changes only what it is told: the rest of the columns stay and the matrix is not rewritten', async () => {
    const { harness, result } = patch('bodega', { isActive: true });
    await expect(result).resolves.toMatchObject({ id: 'bodega' });
    expect(harness.wrote('UPDATE roles')[0].params).toEqual([
      null,
      null,
      1,
      null,
      'bodega',
    ]);
    expect(harness.wrote('DELETE FROM role_permissions')).toEqual([]);
  });

  it('lets the owner edit the matrix of the administrator, which may hold users:manage', async () => {
    const { result } = patch('admin', {
      permissions: ['account:self', 'users:manage', 'sellers:manage'],
    });
    await expect(result).resolves.toMatchObject({ id: 'bodega' });
  });

  it('refuses a role of the system (owner, customer): SYSTEM_ROLE_PROTECTED', async () => {
    const { harness, result } = patch('owner', { name: 'Otro' }, OWNER, {
      system: 1,
    });
    await expect(result).resolves.toBe('SYSTEM_ROLE_PROTECTED');
    expect(harness.wrote('UPDATE roles')).toEqual([]);
  });

  it('refuses everyone but the owner before it even looks at the role', async () => {
    const { harness, result } = patch('bodega', { name: 'X1' }, ADMIN);
    await expect(result).resolves.toBe('OWNER_ONLY_FORBIDDEN');
    expect(harness.wrote('SELECT is_system')).toEqual([]);
  });

  it('knows no role that does not exist, and asks for the second factor', async () => {
    await expect(
      patch('nada', { name: 'X1' }, OWNER, { system: null }).result
    ).resolves.toBe('ROLE_NOT_FOUND');
    await expect(
      patch('bodega', { name: 'X1' }, { ...OWNER, totpEnabled: false }).result
    ).resolves.toBe('TWO_FACTOR_REQUIRED');
  });

  it('keeps the administrator role out of its own gift and switched on', async () => {
    await expect(
      patch('admin', { assignableByAdmin: true }).result
    ).resolves.toBe('ROLE_INVARIANT_VIOLATED');
    await expect(patch('admin', { isActive: false }).result).resolves.toBe(
      'ROLE_INVARIANT_VIOLATED'
    );
  });

  it('refuses a matrix that breaks an invariant, and writes nothing (T2.7)', async () => {
    const { harness, result } = patch('bodega', {
      permissions: ['account:self', 'roles:manage'],
    });
    await expect(result).resolves.toBe('MATRIX_INVARIANT_VIOLATED');
    expect(harness.wrote('UPDATE roles')).toEqual([]);
  });
});
