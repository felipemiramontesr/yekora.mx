/**
 * FC 044 F1 evidence: only the owner manages administrators (T1.4, OWNER_ROLE_REQUIRED), no
 * route changes an owner account (T2.1, OWNER_IMMUTABLE), a new administrator gets a 15-minute
 * link and never a temporary password (T1.2, T2.2), and switching one off or withdrawing the
 * role ends its sessions and remembered devices in the same transaction (T1.3, T2.5). Every
 * write runs once per Idempotency-Key and leaves an audit entry without personal data (T2.3).
 *
 * The database is an in-memory table of handlers keyed by the start of each statement, so the
 * real guard, routes and services run unchanged.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { decryptTotpSecret, tokenHash } from '../services/authCrypto';
import type { Db, Transactional } from '../services/db';
import { verifyPassword } from '../services/passwords';

const KEY = Buffer.alloc(32, 7);
const NOW = new Date('2026-11-11T18:00:00Z');

const OWNER = 'a0000000-0000-4000-8000-000000000001';
const ADMIN = 'a0000000-0000-4000-8000-000000000002';
const BUYER = 'a0000000-0000-4000-8000-000000000003';
const UNKNOWN = 'a0000000-0000-4000-8000-00000000000f';

/** Session cookies: `w` the owner, `a` the administrator, `b` the buyer. */
const TOKENS = new Map([
  [tokenHash('w'.repeat(43)), OWNER],
  [tokenHash('a'.repeat(43)), ADMIN],
  [tokenHash('b'.repeat(43)), BUYER],
]);
const session = (letter: string) =>
  `__Host-yekora_session=${letter.repeat(43)}`;

const ALL = [
  'account:self',
  'orders:read',
  'catalog:write',
  'users:manage',
  'audit:read',
];
const PERMISSIONS: Record<string, string[]> = {
  owner: ALL,
  admin: ALL,
  customer: ['account:self'],
};

interface User {
  id: string;
  email: string;
  hash: string;
  name: string;
  active: number;
  created: Date;
}

/** The tables the fake database holds. */
const store = {
  users: [] as User[],
  roles: [] as [user: string, role: string][],
  totp: [] as string[],
  sessions: [] as string[],
  devices: [] as string[],
  resets: [] as { user: string; hash: string; expires: Date }[],
  outbox: [] as { type: string; payload: Record<string, string> }[],
  audit: [] as unknown[][],
  keys: new Map<string, Record<string, unknown>>(),
};

const user = (id: string, email: string, name: string): User => ({
  id,
  email,
  hash: '$argon2id$old',
  name,
  active: 1,
  created: new Date('2026-11-01T00:00:00Z'),
});

const rolesOf = (id: unknown) =>
  store.roles
    .filter(([owner]) => owner === id)
    .map(([, role]) => role)
    .sort((a, b) => a.localeCompare(b, 'en'));

const without = (list: string[], id: unknown) => {
  list.splice(0, list.length, ...list.filter((entry) => entry !== id));
  return [];
};

const grant = (id: unknown, role: string) => {
  if (!rolesOf(id).includes(role)) store.roles.push([id as string, role]);
};

/** A user as the console query returns it. */
const card = (row: User) => ({
  id: row.id,
  email: row.email,
  full_name: row.name,
  is_active: row.active,
  created_at: row.created,
  roles: rolesOf(row.id).join(','),
  totp_enabled: store.totp.includes(row.id) ? 1 : 0,
});

const CARD =
  'SELECT u.id, u.email, u.full_name, u.is_active, u.created_at, GROUP_CONCAT(ur.role_id ORDER BY ur.role_id) AS roles, COALESCE(MAX(t.is_totp_enabled), 0) AS totp_enabled FROM users u JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN two_factor_auth t ON t.user_id = u.id ';

type Handler = (params: readonly unknown[]) => unknown[];

const HANDLERS: [string, Handler][] = [
  [
    'SELECT s.id, s.user_id',
    (p) => {
      const id = TOKENS.get(p[0] as string);
      const found = store.users.find((row) => row.id === id);
      return found && store.sessions.includes(found.id)
        ? [
            {
              id: p[0],
              user_id: found.id,
              email: found.email,
              full_name: found.name,
            },
          ]
        : [];
    },
  ],
  [
    'SELECT ur.role_id',
    (p) =>
      rolesOf(p[0]).flatMap((role) =>
        PERMISSIONS[role].map((permission) => ({
          role_id: role,
          permission_id: permission,
        }))
      ),
  ],
  [
    'SELECT is_totp_enabled',
    (p) => [{ is_totp_enabled: store.totp.includes(p[0] as string) ? 1 : 0 }],
  ],
  [
    'SELECT route, request_hash',
    (p) => {
      const row = store.keys.get(p[0] as string);
      return row ? [row] : [];
    },
  ],
  [
    'INSERT INTO idempotency_keys',
    (p) => {
      store.keys.set(p[0] as string, {
        route: p[2],
        request_hash: p[3],
        response_status: p[4],
        response_body: p[6],
        expires_at: p[7],
      });
      return [];
    },
  ],
  [
    `${CARD}GROUP BY`,
    () =>
      store.users
        .filter((row) =>
          rolesOf(row.id).some((role) => role === 'owner' || role === 'admin')
        )
        .sort(
          (a, b) =>
            Number(rolesOf(b.id).includes('owner')) -
              Number(rolesOf(a.id).includes('owner')) ||
            a.email.localeCompare(b.email, 'en')
        )
        .map(card),
  ],
  [
    `${CARD}WHERE u.id = ?`,
    (p) => store.users.filter((row) => row.id === p[0]).map(card),
  ],
  [
    'SELECT id FROM users WHERE email = ? FOR UPDATE',
    (p) =>
      store.users.filter((row) => row.email === p[0]).map(({ id }) => ({ id })),
  ],
  [
    'SELECT role_id FROM user_roles WHERE user_id = ? FOR UPDATE',
    (p) => rolesOf(p[0]).map((role_id) => ({ role_id })),
  ],
  [
    'UPDATE users SET is_active = 1 WHERE id',
    (p) => {
      (store.users.find((row) => row.id === p[0]) as User).active = 1;
      return [];
    },
  ],
  [
    'UPDATE users SET is_active = ? WHERE id',
    (p) => {
      (store.users.find((row) => row.id === p[1]) as User).active =
        p[0] as number;
      return [];
    },
  ],
  [
    'INSERT INTO users',
    (p) => {
      const [id, email, hash, name] = p as string[];
      store.users.push({ id, email, hash, name, active: 1, created: NOW });
      return [];
    },
  ],
  [
    "INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, 'customer'), (?, 'admin')",
    (p) => {
      grant(p[0], 'customer');
      grant(p[1], 'admin');
      return [];
    },
  ],
  [
    "INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, 'customer')",
    (p) => {
      grant(p[0], 'customer');
      return [];
    },
  ],
  [
    "DELETE FROM user_roles WHERE user_id = ? AND role_id = 'admin'",
    (p) => {
      store.roles = store.roles.filter(
        ([owner, role]) => owner !== p[0] || role !== 'admin'
      );
      return [];
    },
  ],
  ['DELETE FROM user_sessions', (p) => without(store.sessions, p[0])],
  ['DELETE FROM user_trusted_devices', (p) => without(store.devices, p[0])],
  [
    'INSERT INTO password_reset_tokens',
    (p) => {
      const [owner, hash, expires] = p as [string, string, Date];
      store.resets.push({ user: owner, hash, expires });
      return [];
    },
  ],
  [
    'INSERT INTO outbox_events',
    (p) => {
      store.outbox.push({
        type: p[0] as string,
        payload: JSON.parse(p[1] as string),
      });
      return [];
    },
  ],
  [
    'INSERT INTO audit_log',
    (p) => {
      store.audit.push([...p]);
      return [];
    },
  ],
];

const db: Db & Transactional = {
  async query<Row>(text: string, params: readonly unknown[] = []) {
    const handler = HANDLERS.find(([start]) => text.startsWith(start));
    return (handler ? handler[1](params) : []) as Row[];
  },
  ping: async () => undefined,
  transaction(work) {
    return work(this);
  },
  close: async () => undefined,
};

let app: FastifyInstance;

/** Lets the onResponse audit hook, which runs after the answer has left, finish. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** The entries the services wrote in their transaction (the hook's are per request). */
const written = (action: string) =>
  store.audit.filter((row) => row[1] === action);

beforeAll(async () => {
  app = await buildApp({
    config: loadConfig({
      DB_HOST: '127.0.0.1',
      DB_USER: 'root',
      DB_NAME: 'yekora_dev',
      AUTH_SECRET: KEY.toString('base64'),
      TOTP_ENCRYPTION_KEY: KEY.toString('base64'),
    }),
    db,
    rate: async () => null,
    logger: false,
    now: () => NOW,
  });
  await app.ready();
}, 30_000);

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  store.users = [
    user(OWNER, 'owner@example.test', 'GrayMan'),
    user(ADMIN, 'zoe@example.test', 'Zoe Admin'),
    user(BUYER, 'ana@example.test', 'Ana Compradora'),
  ];
  store.roles = [
    [OWNER, 'owner'],
    [ADMIN, 'customer'],
    [ADMIN, 'admin'],
    [BUYER, 'customer'],
  ];
  store.totp = [OWNER, ADMIN];
  store.sessions = [OWNER, ADMIN, BUYER];
  store.devices = [BUYER];
  store.resets = [];
  store.outbox = [];
  store.audit = [];
  store.keys.clear();
});

const list = (who: string | null) =>
  app.inject({
    method: 'GET',
    url: '/v1/admin/admins',
    headers: who === null ? {} : { cookie: session(who) },
  });

/** A write as the owner (or another session), with a key unless told otherwise. */
const write = (
  method: 'POST' | 'PATCH',
  url: string,
  payload: unknown,
  options: { who?: string; key?: string | null } = {}
) =>
  app.inject({
    method,
    url,
    headers: {
      cookie: session(options.who ?? 'w'),
      'content-type': 'application/json',
      ...(options.key === null
        ? {}
        : { 'idempotency-key': options.key ?? 'k-1' }),
    },
    payload: JSON.stringify(payload),
  });

const create = (
  payload: unknown,
  options: { who?: string; key?: string | null } = {}
) => write('POST', '/v1/admin/admins', payload, options);

const update = (
  id: string,
  payload: unknown,
  options: { who?: string; key?: string | null } = {}
) => write('PATCH', `/v1/admin/admins/${id}`, payload, options);

const NEW_ADMIN = { email: ' Leo@Example.TEST ', fullName: 'Leo Nuevo' };

describe('GET /v1/admin/admins (FC 044 T1.4)', () => {
  it('ADMIN_LIST_GRANTED · lists the owner first, then the administrators, with roles and second factor', async () => {
    const response = await list('w');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        {
          id: OWNER,
          email: 'owner@example.test',
          fullName: 'GrayMan',
          roles: ['owner'],
          isActive: true,
          totpEnabled: true,
          createdAt: '2026-11-01T00:00:00.000Z',
        },
        {
          id: ADMIN,
          email: 'zoe@example.test',
          fullName: 'Zoe Admin',
          roles: ['admin', 'customer'],
          isActive: true,
          totpEnabled: true,
          createdAt: '2026-11-01T00:00:00.000Z',
        },
      ],
    });
  });

  it('ADMIN_LIST_NOT_OWNER · refuses an administrator, who holds users:manage but not the role', async () => {
    const response = await list('a');
    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toBe('OWNER_ROLE_REQUIRED');
  });

  it('ADMIN_LIST_PERMISSION_DENIED · refuses a buyer at the guard, and nobody without a session', async () => {
    const buyer = await list('b');
    expect(buyer.statusCode).toBe(403);
    expect(buyer.json().detail).toBe('PERMISSION_DENIED');
    expect((await list(null)).statusCode).toBe(401);
  });
});

describe('POST /v1/admin/admins (FC 044 T1.2, T2.2, T2.3)', () => {
  it('ADMIN_CREATE_DISPATCHED · creates the account with an unmatchable hash, mails a 15-minute link and audits without personal data', async () => {
    const response = await create(NEW_ADMIN);
    expect(response.statusCode).toBe(201);
    expect(response.headers['idempotency-status']).toBe(
      'IDEMP_FIRST_EXECUTION'
    );
    const created = store.users.at(-1) as User;
    expect(response.json()).toEqual({
      id: created.id,
      email: 'leo@example.test',
      fullName: 'Leo Nuevo',
      roles: ['admin', 'customer'],
      isActive: true,
      totpEnabled: false,
      createdAt: NOW.toISOString(),
    });
    // T2.2: no password opens the account; the only way in is the mailed link.
    expect(created.hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword(created.hash, '')).toBe(false);
    const [mail] = store.outbox;
    expect(store.outbox).toHaveLength(1);
    expect(mail).toMatchObject({
      type: 'PASSWORD_RESET',
      payload: { userId: created.id },
    });
    const token = decryptTotpSecret(
      KEY,
      created.id,
      mail.payload.token
    ).toString('utf8');
    expect(store.resets).toEqual([
      {
        user: created.id,
        hash: tokenHash(token),
        expires: new Date(NOW.getTime() + 15 * 60_000),
      },
    ]);
    // T2.3: the owner is the actor; neither the address nor the name reaches the trail.
    expect(written('ADMIN_CREATED')).toEqual([
      [
        OWNER,
        'ADMIN_CREATED',
        'users',
        created.id,
        null,
        JSON.stringify({ role: 'admin', created: true }),
        expect.any(String),
      ],
    ]);
    await settle();
    const trail = JSON.stringify(store.audit);
    expect(trail).not.toContain('leo@example.test');
    expect(trail).not.toContain('Leo Nuevo');
  });

  it('runs once per Idempotency-Key: a repeat replays the answer, another body under the same key is a 409', async () => {
    const first = await create(NEW_ADMIN);
    const again = await create(NEW_ADMIN);
    expect(again.statusCode).toBe(201);
    expect(again.headers['idempotency-status']).toBe('IDEMP_REPLAY_SUCCESS');
    expect(again.json()).toEqual(first.json());
    expect(store.users).toHaveLength(4);
    expect(store.outbox).toHaveLength(1);
    const other = await create({ ...NEW_ADMIN, fullName: 'Otro Nombre' });
    expect(other.statusCode).toBe(409);
    expect(other.json().detail).toBe('IDEMP_PAYLOAD_MISMATCH');
  });

  it('promotes an existing buyer: same account and password, switched on, with no session nor remembered device left', async () => {
    (store.users[2] as User).active = 0;
    const response = await create({
      email: 'ana@example.test',
      fullName: 'Nombre Ignorado',
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      id: BUYER,
      fullName: 'Ana Compradora',
      roles: ['admin', 'customer'],
      isActive: true,
    });
    expect(store.users).toHaveLength(3);
    expect(store.users[2].hash).toBe('$argon2id$old');
    expect(store.sessions).toEqual([OWNER, ADMIN]);
    expect(store.devices).toEqual([]);
    expect(store.outbox[0].payload.userId).toBe(BUYER);
    expect(written('ADMIN_CREATED')[0][5]).toBe(
      JSON.stringify({ role: 'admin', created: false })
    );
    // The buyer's old session no longer exists: the new role needs a fresh sign-in.
    expect((await list('b')).statusCode).toBe(401);
  });

  it('ADMIN_CREATE_OWNER_IMMUTABLE and ADMIN_CREATE_ALREADY_ADMIN · changes nothing for an owner or an administrator', async () => {
    const owner = await create({
      email: 'owner@example.test',
      fullName: 'Otro Nombre',
    });
    expect(owner.statusCode).toBe(403);
    expect(owner.json().detail).toBe('OWNER_IMMUTABLE');
    const admin = await create(
      { email: 'zoe@example.test', fullName: 'Zoe Admin' },
      { key: 'k-2' }
    );
    expect(admin.statusCode).toBe(409);
    expect(admin.json().detail).toBe('ADMIN_ALREADY_EXISTS');
    expect(store.roles).toHaveLength(4);
    expect(store.sessions).toEqual([OWNER, ADMIN, BUYER]);
    expect(store.outbox).toEqual([]);
    expect(written('ADMIN_CREATED')).toEqual([]);
  });

  it('ADMIN_CREATE_INVALID_BODY · refuses a body that is not an e-mail and a name', async () => {
    for (const body of [
      {},
      { email: 'not-an-address', fullName: 'Leo Nuevo' },
      { email: 'leo@example.test', fullName: 'L' },
      { ...NEW_ADMIN, role: 'owner' },
    ]) {
      const response = await create(body);
      expect(response.statusCode).toBe(400);
      expect(response.json().detail).toBe('INVALID_REQUEST');
    }
    expect(store.users).toHaveLength(3);
  });

  it('ADMIN_CREATE_NOT_OWNER · refuses an administrator before reading the body; the key comes first', async () => {
    const admin = await create({}, { who: 'a' });
    expect(admin.statusCode).toBe(403);
    expect(admin.json().detail).toBe('OWNER_ROLE_REQUIRED');
    const noKey = await create(NEW_ADMIN, { key: null });
    expect(noKey.statusCode).toBe(400);
    expect(noKey.json().detail).toBe('IDEMP_KEY_MISSING');
    expect(store.users).toHaveLength(3);
  });
});

describe('PATCH /v1/admin/admins/:id (FC 044 T1.3, T2.1, T2.5)', () => {
  it('ADMIN_MUTATION_APPLIED · switches an administrator off and ends its sessions and devices, audited', async () => {
    store.devices.push(ADMIN);
    const response = await update(ADMIN, { isActive: false });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: ADMIN,
      roles: ['admin', 'customer'],
      isActive: false,
    });
    expect(store.sessions).toEqual([OWNER, BUYER]);
    expect(store.devices).toEqual([BUYER]);
    expect(written('ADMIN_UPDATED')).toEqual([
      [
        OWNER,
        'ADMIN_UPDATED',
        'users',
        ADMIN,
        JSON.stringify({ isActive: true, roles: ['admin', 'customer'] }),
        JSON.stringify({ isActive: false, roles: ['admin', 'customer'] }),
        expect.any(String),
      ],
    ]);
    // T2.5: the administrator's cookie opens nothing any more.
    expect((await list('a')).statusCode).toBe(401);
  });

  it('switches an administrator back on without touching its sessions', async () => {
    (store.users[1] as User).active = 0;
    const response = await update(ADMIN, { isActive: true });
    expect(response.statusCode).toBe(200);
    expect(response.json().isActive).toBe(true);
    expect(store.sessions).toEqual([OWNER, ADMIN, BUYER]);
  });

  it('withdraws the role: the account stays a buyer and must sign in again', async () => {
    store.roles = store.roles.filter(
      ([owner, role]) => owner !== ADMIN || role !== 'customer'
    );
    const response = await update(ADMIN, { revokeAdmin: true });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: ADMIN,
      roles: ['customer'],
      isActive: true,
    });
    expect(store.sessions).toEqual([OWNER, BUYER]);
    expect(written('ADMIN_UPDATED')[0].slice(4, 6)).toEqual([
      JSON.stringify({ isActive: true, roles: ['admin'] }),
      JSON.stringify({ isActive: true, roles: ['customer'] }),
    ]);
    // A second withdrawal finds no administrator.
    const again = await update(ADMIN, { revokeAdmin: true }, { key: 'k-2' });
    expect(again.statusCode).toBe(404);
  });

  it('changes nothing when asked not to withdraw the role', async () => {
    const response = await update(ADMIN, { revokeAdmin: false });
    expect(response.statusCode).toBe(200);
    expect(response.json().roles).toEqual(['admin', 'customer']);
    expect(store.sessions).toEqual([OWNER, ADMIN, BUYER]);
  });

  it('ADMIN_MUTATION_OWNER_IMMUTABLE · refuses any change to the owner, even by the owner (T2.1)', async () => {
    for (const [key, body] of [
      ['k-1', { isActive: false }],
      ['k-2', { revokeAdmin: true }],
    ] as const) {
      const response = await update(OWNER, body, { key });
      expect(response.statusCode).toBe(403);
      expect(response.json().detail).toBe('OWNER_IMMUTABLE');
    }
    expect(store.users[0].active).toBe(1);
    expect(store.roles).toContainEqual([OWNER, 'owner']);
    expect(store.sessions).toContain(OWNER);
  });

  it('ADMIN_MUTATION_NOT_FOUND · answers 404 for a buyer and for an unknown account', async () => {
    const buyer = await update(BUYER, { isActive: false });
    expect(buyer.statusCode).toBe(404);
    expect(buyer.json().detail).toBe('ADMIN_NOT_FOUND');
    const unknown = await update(UNKNOWN, { isActive: false }, { key: 'k-2' });
    expect(unknown.statusCode).toBe(404);
    expect(store.users[2].active).toBe(1);
    expect(store.sessions).toContain(BUYER);
  });

  it('ADMIN_MUTATION_INVALID_BODY · refuses a malformed id, an empty body and unknown fields', async () => {
    for (const [id, body] of [
      ['not-a-uuid', { isActive: false }],
      [ADMIN, {}],
      [ADMIN, { isActive: 'no' }],
      [ADMIN, { isActive: false, role: 'owner' }],
    ] as const) {
      const response = await update(id, body);
      expect(response.statusCode).toBe(400);
      expect(response.json().detail).toBe('INVALID_REQUEST');
    }
    expect(store.users[1].active).toBe(1);
  });

  it('ADMIN_MUTATION_NOT_OWNER · refuses an administrator before reading the request; the key comes first', async () => {
    const admin = await update('not-a-uuid', {}, { who: 'a' });
    expect(admin.statusCode).toBe(403);
    expect(admin.json().detail).toBe('OWNER_ROLE_REQUIRED');
    const noKey = await update(ADMIN, { isActive: false }, { key: null });
    expect(noKey.statusCode).toBe(400);
    expect(noKey.json().detail).toBe('IDEMP_KEY_MISSING');
    expect(store.users[1].active).toBe(1);
  });
});
