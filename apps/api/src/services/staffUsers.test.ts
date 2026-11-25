/**
 * FC 072 F1 evidence of the staff: the 8 rows of T1.1, the hierarchy Dueño › Administrador ›
 * Vendedor (T2.2), the owner that nothing reaches (T2.1), the access that ends with a switch off
 * or a change of roles (T2.3), no password for a new account (T2.4) and the audit (T2.5).
 */
import { describe, expect, it } from 'vitest';
import type { TxQuery } from './db';
import { decideStaffMutation } from './staffGates';
import { createStaff, listStaff, updateStaff } from './staffUsers';

const NOW = new Date('2026-11-24T18:00:00.000Z');
const KEY = Buffer.alloc(32, 7);

const OWNER = {
  userId: 'owner-1',
  roles: ['owner', 'customer'],
  totpEnabled: true,
  ip: '203.0.113.9',
};
const ADMIN = {
  userId: 'admin-1',
  roles: ['admin', 'customer'],
  totpEnabled: true,
  ip: '203.0.113.9',
};
const SELLER = {
  userId: 'seller-1',
  roles: ['staff_orders', 'customer'],
  totpEnabled: true,
  ip: '203.0.113.11',
};

/** The roles of the catalog as the check reads them. */
const CATALOG = [
  { id: 'admin', is_active: 1, assignable_by_admin: 0 },
  { id: 'staff_orders', is_active: 1, assignable_by_admin: 1 },
  { id: 'staff_catalog', is_active: 1, assignable_by_admin: 1 },
  { id: 'retired', is_active: 0, assignable_by_admin: 1 },
  { id: 'owner', is_active: 1, assignable_by_admin: 0 },
  { id: 'customer', is_active: 1, assignable_by_admin: 0 },
];

interface Scenario {
  /** The id of the account with the e-mail, or null when there is none. */
  existing: string | null;
  /** The roles that account holds. */
  held: string[];
  /** The account as the panel reads it after the write. */
  roles: string;
  isActive: number;
  list: Record<string, unknown>[];
}

function fakeDb(over: Partial<Scenario> = {}) {
  const s: Scenario = {
    existing: null,
    held: [],
    roles: 'customer,staff_orders',
    isActive: 1,
    list: [],
    ...over,
  };
  const log: { sql: string; params: readonly unknown[] }[] = [];
  const row = {
    id: 'u-1',
    email: 'ana@example.test',
    full_name: 'Ana',
    is_active: 1,
    created_at: NOW,
    totp_enabled: 0,
  };
  async function query<Row>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<Row[]> {
    log.push({ sql, params });
    if (
      sql.startsWith('SELECT id, is_active, assignable_by_admin FROM roles')
    ) {
      const wanted = (params[0] as string[]) ?? [];
      return CATALOG.filter((item) => wanted.includes(item.id)) as Row[];
    }
    if (sql.startsWith('SELECT id FROM users WHERE email')) {
      return (s.existing === null ? [] : [{ id: s.existing }]) as Row[];
    }
    if (sql.startsWith('SELECT role_id FROM user_roles')) {
      return s.held.map((role_id) => ({ role_id })) as Row[];
    }
    if (sql.startsWith('SELECT u.id, u.email, u.full_name')) {
      if (params.length === 0) return s.list as Row[];
      return [{ ...row, roles: s.roles, is_active: s.isActive }] as Row[];
    }
    return { affectedRows: 1 } as unknown as Row[];
  }
  const db: TxQuery = { query };
  const wrote = (opening: string) =>
    log.filter((entry) => entry.sql.startsWith(opening));
  return { db, log, wrote };
}

describe('T1.1 · StaffUserMutationGate(P, T, V), the 8 rows', () => {
  const rows = [
    [true, true, true, 'MUTATION_PERMITTED_200'],
    [true, true, false, 'VALIDATION_OR_2FA_FAILED_400'],
    [true, false, true, 'TARGET_ROLE_FORBIDDEN_403'],
    [true, false, false, 'TARGET_ROLE_FORBIDDEN_403'],
    [false, true, true, 'ACTOR_UNAUTHORIZED_403'],
    [false, true, false, 'ACTOR_UNAUTHORIZED_403'],
    [false, false, true, 'ACTOR_UNAUTHORIZED_403'],
    [false, false, false, 'ACTOR_UNAUTHORIZED_403'],
  ] as const;

  it.each(rows)(
    'P=%s T=%s V=%s → %s',
    (privileged, rolePermitted, valid, code) => {
      expect(decideStaffMutation({ privileged, rolePermitted, valid })).toBe(
        code
      );
    }
  );
});

describe('listStaff (T2.2: an administrator does not see the owner or the administrators)', () => {
  const LISTED = [
    {
      id: 'u-1',
      email: 'ana@example.test',
      full_name: 'Ana',
      is_active: '1',
      created_at: NOW,
      roles: 'customer,staff_orders',
      totp_enabled: '1',
    },
  ];

  it('gives the owner the staff and an administrator the staff it may give', async () => {
    const owner = fakeDb({ list: LISTED });
    await expect(listStaff(owner.db, true)).resolves.toEqual([
      {
        id: 'u-1',
        email: 'ana@example.test',
        fullName: 'Ana',
        roles: ['customer', 'staff_orders'],
        isActive: true,
        totpEnabled: true,
        createdAt: NOW.toISOString(),
      },
    ]);
    expect(owner.log[0].sql).not.toContain('assignable_by_admin');
    const admin = fakeDb({ list: [] });
    await expect(listStaff(admin.db, false)).resolves.toEqual([]);
    expect(admin.log[0].sql).toContain('r.assignable_by_admin = 0');
  });
});

describe('createStaff', () => {
  const create = (
    actor: typeof OWNER,
    roles: string[],
    over: Partial<Scenario> = {},
    email = 'ana@example.test'
  ) => {
    const harness = fakeDb(over);
    return {
      harness,
      result: createStaff(
        harness.db,
        { email, fullName: 'Ana', roles, totpKey: KEY, now: NOW },
        actor
      ),
    };
  };

  it('lets the owner bring in an administrator: a new account with no password, a link mailed and an audit entry (T2.4, T2.5)', async () => {
    const { harness, result } = create(OWNER, ['admin']);
    await expect(result).resolves.toMatchObject({
      id: 'u-1',
      roles: ['customer', 'staff_orders'],
    });
    const born = harness.wrote('INSERT INTO users')[0];
    expect(born.params[1]).toBe('ana@example.test');
    expect(String(born.params[2])).toMatch(/^\$argon2id\$/);
    expect(harness.wrote('INSERT IGNORE INTO user_roles')[0].params).toEqual([
      [
        [expect.any(String), 'customer'],
        [expect.any(String), 'admin'],
      ],
    ]);
    expect(harness.wrote('INSERT INTO outbox_events')).toHaveLength(1);
    expect(harness.wrote('INSERT INTO audit_log')[0].params).toContain(
      'STAFF_CREATED'
    );
  });

  it('lets an administrator bring in a seller and a support role', async () => {
    const { result } = create(ADMIN, ['staff_orders', 'staff_catalog']);
    await expect(result).resolves.toMatchObject({ id: 'u-1' });
  });

  it('refuses an administrator who reaches for the administrator role: ADMIN_CANNOT_ELEVATE_ADMIN (T2.2)', async () => {
    const { harness, result } = create(ADMIN, ['admin']);
    await expect(result).resolves.toBe('ADMIN_CANNOT_ELEVATE_ADMIN');
    expect(harness.wrote('INSERT')).toEqual([]);
  });

  it.each([['owner'], ['customer']])(
    'refuses the owner giving %s, which this panel never gives',
    async (role) => {
      await expect(create(OWNER, [role]).result).resolves.toBe(
        'TARGET_ROLE_FORBIDDEN'
      );
    }
  );

  it('refuses a role that does not exist or is retired, and one of the staff without the privilege', async () => {
    await expect(create(OWNER, ['nope']).result).resolves.toBe(
      'ROLE_NOT_FOUND'
    );
    await expect(create(OWNER, ['retired']).result).resolves.toBe(
      'ROLE_NOT_FOUND'
    );
    await expect(create(SELLER, ['staff_orders']).result).resolves.toBe(
      'ACTOR_UNAUTHORIZED'
    );
    await expect(
      create({ ...OWNER, totpEnabled: false }, ['staff_orders']).result
    ).resolves.toBe('VALIDATION_OR_2FA_FAILED');
  });

  it('brings in an existing buyer: switched on and with its access ended so no session inherits the roles', async () => {
    const { harness, result } = create(OWNER, ['staff_orders'], {
      existing: 'u-1',
      held: ['customer'],
    });
    await expect(result).resolves.toMatchObject({ id: 'u-1' });
    expect(harness.wrote('INSERT INTO users')).toEqual([]);
    expect(harness.wrote('UPDATE users SET is_active = 1')[0].params).toEqual([
      'u-1',
    ]);
    expect(harness.wrote('DELETE FROM user_sessions')).toHaveLength(1);
    expect(harness.wrote('DELETE FROM user_trusted_devices')).toHaveLength(1);
  });

  it('never touches the owner, and an account already in the staff is a conflict', async () => {
    await expect(
      create(OWNER, ['staff_orders'], {
        existing: 'u-9',
        held: ['owner', 'customer'],
      }).result
    ).resolves.toBe('OWNER_IMMUTABLE');
    await expect(
      create(OWNER, ['staff_orders'], {
        existing: 'u-9',
        held: ['customer', 'staff_catalog'],
      }).result
    ).resolves.toBe('STAFF_ALREADY_EXISTS');
  });
});

describe('updateStaff', () => {
  const update = (
    actor: typeof OWNER,
    input: { isActive?: boolean; roles?: string[] },
    held: string[],
    over: Partial<Scenario> = {}
  ) => {
    const harness = fakeDb({ held, ...over });
    return {
      harness,
      result: updateStaff(harness.db, { id: 'u-1', ...input }, actor),
    };
  };

  it('switches an account off and ends its sessions and devices in the same transaction (T2.3)', async () => {
    const { harness, result } = update(
      ADMIN,
      { isActive: false },
      ['customer', 'staff_orders'],
      { isActive: 0 }
    );
    await expect(result).resolves.toMatchObject({ isActive: false });
    expect(harness.wrote('UPDATE users SET is_active = ?')[0].params).toEqual([
      0,
      'u-1',
    ]);
    expect(harness.wrote('DELETE FROM user_sessions')).toHaveLength(1);
    expect(harness.wrote('DELETE FROM user_trusted_devices')).toHaveLength(1);
    expect(harness.wrote('INSERT INTO audit_log')[0].params).toContain(
      'STAFF_UPDATED'
    );
  });

  it('switching on does not end the access', async () => {
    const { harness } = update(ADMIN, { isActive: true }, [
      'customer',
      'staff_orders',
    ]);
    await expect(
      updateStaff(harness.db, { id: 'u-1', isActive: true }, ADMIN)
    ).resolves.toMatchObject({ id: 'u-1' });
    expect(harness.wrote('DELETE FROM user_sessions')).toEqual([]);
  });

  it('replaces the roles, keeps the buyer one and ends the access', async () => {
    const { harness, result } = update(OWNER, { roles: ['staff_catalog'] }, [
      'customer',
      'staff_orders',
    ]);
    await expect(result).resolves.toMatchObject({ id: 'u-1' });
    expect(harness.wrote('DELETE FROM user_roles')[0].sql).toContain(
      "role_id <> 'customer'"
    );
    expect(harness.wrote('INSERT IGNORE INTO user_roles')[0].params).toEqual([
      [['u-1', 'staff_catalog']],
    ]);
    expect(harness.wrote('DELETE FROM user_sessions')).toHaveLength(1);
  });

  it('refuses the owner account to everyone, the owner included (T2.1)', async () => {
    for (const actor of [OWNER, ADMIN]) {
      const { harness, result } = update(actor, { isActive: false }, [
        'owner',
        'customer',
      ]);
      await expect(result).resolves.toBe('OWNER_IMMUTABLE');
      expect(harness.wrote('UPDATE')).toEqual([]);
    }
  });

  it('refuses an administrator who reaches an administrator or gives a role it cannot (T2.2)', async () => {
    await expect(
      update(ADMIN, { isActive: false }, ['admin', 'customer']).result
    ).resolves.toBe('ADMIN_CANNOT_ELEVATE_ADMIN');
    await expect(
      update(ADMIN, { roles: ['admin'] }, ['customer', 'staff_orders']).result
    ).resolves.toBe('ADMIN_CANNOT_ELEVATE_ADMIN');
  });

  it('knows no buyer and no unknown account as staff: 404 USER_NOT_FOUND', async () => {
    await expect(
      update(OWNER, { isActive: false }, ['customer']).result
    ).resolves.toBe('USER_NOT_FOUND');
    await expect(update(OWNER, { isActive: false }, []).result).resolves.toBe(
      'USER_NOT_FOUND'
    );
  });

  it('refuses a role that does not exist and an actor outside the hierarchy', async () => {
    await expect(
      update(OWNER, { roles: ['nope'] }, ['customer', 'staff_orders']).result
    ).resolves.toBe('ROLE_NOT_FOUND');
    await expect(
      update(SELLER, { isActive: false }, ['customer', 'staff_orders']).result
    ).resolves.toBe('ACTOR_UNAUTHORIZED');
  });
});
