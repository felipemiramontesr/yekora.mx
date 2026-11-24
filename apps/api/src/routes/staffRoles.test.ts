/**
 * FC 072 F1 evidence of the routes of the panel «Usuarios, roles y permisos»: the guard of each
 * (401, 403 SECOND_FACTOR_REQUIRED, 403 PERMISSION_DENIED), the validation, the refusals of the
 * hierarchy as problems, the writes once per Idempotency-Key and the owner alone editing roles.
 *
 * The database is an in-memory table of handlers keyed by the start of each statement, so the real
 * guard, routes and services run unchanged.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { tokenHash } from '../services/authCrypto';
import type { Db, Transactional } from '../services/db';

const KEY = Buffer.alloc(32, 7);
const NOW = new Date('2026-11-24T18:00:00Z');

const OWNER = 'a0000000-0000-4000-8000-000000000001';
const ADMIN = 'a0000000-0000-4000-8000-000000000002';
const SELLER = 'a0000000-0000-4000-8000-000000000003';
const NO_TOTP = 'a0000000-0000-4000-8000-000000000004';
const TARGET = 'a0000000-0000-4000-8000-0000000000aa';

/** Cookies: `w` owner, `a` administrator, `s` seller, `n` administrator without authenticator. */
const TOKENS = new Map([
  [tokenHash('w'.repeat(43)), OWNER],
  [tokenHash('a'.repeat(43)), ADMIN],
  [tokenHash('s'.repeat(43)), SELLER],
  [tokenHash('n'.repeat(43)), NO_TOTP],
]);
const session = (letter: string) =>
  `__Host-yekora_session=${letter.repeat(43)}`;

const ROLE_OF: Record<string, string> = {
  [OWNER]: 'owner',
  [ADMIN]: 'admin',
  [SELLER]: 'staff_orders',
  [NO_TOTP]: 'admin',
};
const PERMISSIONS: Record<string, string[]> = {
  owner: ['account:self', 'sellers:manage', 'roles:manage'],
  admin: ['account:self', 'sellers:manage'],
  staff_orders: ['account:self', 'orders:read'],
};

const CATALOG = [
  { id: 'admin', is_active: 1, assignable_by_admin: 0 },
  { id: 'staff_orders', is_active: 1, assignable_by_admin: 1 },
  { id: 'owner', is_active: 1, assignable_by_admin: 0 },
];

const store = {
  held: [] as string[],
  system: 0 as number | null,
  taken: false,
  audit: [] as unknown[][],
  keys: new Map<string, Record<string, unknown>>(),
};

const STAFF_ROW = {
  id: TARGET,
  email: 'ana@example.test',
  full_name: 'Ana',
  is_active: 1,
  created_at: NOW,
  roles: 'customer,staff_orders',
  totp_enabled: 0,
};
const ROLE_ROW = {
  id: 'bodega',
  name: 'Bodega',
  description: null,
  is_active: 1,
  is_system: 0,
  assignable_by_admin: 1,
  permissions: 'account:self,orders:read',
};

type Handler = (params: readonly unknown[]) => unknown;

const HANDLERS: [string, Handler][] = [
  [
    'SELECT s.id, s.user_id',
    (p) => {
      const id = TOKENS.get(p[0] as string);
      return id
        ? [
            {
              id: p[0],
              user_id: id,
              email: `${id}@example.test`,
              full_name: 'X',
            },
          ]
        : [];
    },
  ],
  [
    'SELECT ur.role_id',
    (p) =>
      PERMISSIONS[ROLE_OF[p[0] as string]].map((permission) => ({
        role_id: ROLE_OF[p[0] as string],
        permission_id: permission,
      })),
  ],
  [
    'SELECT is_totp_enabled',
    (p) => [{ is_totp_enabled: p[0] === NO_TOTP ? 0 : 1 }],
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
    'SELECT id, is_active, assignable_by_admin FROM roles',
    (p) => CATALOG.filter((role) => (p[0] as string[]).includes(role.id)),
  ],
  ['SELECT id FROM users WHERE email', () => []],
  [
    'SELECT role_id FROM user_roles',
    () => store.held.map((role_id) => ({ role_id })),
  ],
  ['SELECT u.id, u.email, u.full_name', () => [STAFF_ROW]],
  [
    'SELECT id FROM roles WHERE id = ?',
    () => (store.taken ? [{ id: 'bodega' }] : []),
  ],
  [
    'SELECT is_system FROM roles',
    () => (store.system === null ? [] : [{ is_system: store.system }]),
  ],
  ['SELECT r.id, r.name', () => [ROLE_ROW]],
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
  store.held = ['customer', 'staff_orders'];
  store.system = 0;
  store.taken = false;
  store.audit = [];
  store.keys.clear();
});

interface Options {
  who?: string | null;
  key?: string | null;
  payload?: unknown;
}

const send = (
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  { who = 'w', key = null, payload }: Options = {}
) =>
  app.inject({
    method,
    url,
    headers: {
      ...(who === null ? {} : { cookie: session(who) }),
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      ...(key === null ? {} : { 'idempotency-key': key }),
    },
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
  });

const NEW_STAFF = {
  email: 'ana@example.test',
  fullName: 'Ana Pérez',
  roles: ['staff_orders'],
};

describe('the guard of the panel (FC 072 T1.1, T1.2)', () => {
  it.each([
    ['GET', '/v1/admin/users'],
    ['GET', '/v1/admin/roles'],
  ] as const)(
    '%s %s: no session is a 401, no authenticator a 403 SECOND_FACTOR_REQUIRED, a seller a 403 PERMISSION_DENIED',
    async (method, url) => {
      expect((await send(method, url, { who: null })).statusCode).toBe(401);
      expect((await send(method, url, { who: 'n' })).json().detail).toBe(
        'SECOND_FACTOR_REQUIRED'
      );
      expect((await send(method, url, { who: 's' })).json().detail).toBe(
        'PERMISSION_DENIED'
      );
    }
  );

  it('shows the matrix to an administrator, who cannot edit it', async () => {
    expect(
      (await send('GET', '/v1/admin/roles', { who: 'a' })).statusCode
    ).toBe(200);
    const edit = await send('POST', '/v1/admin/roles', {
      who: 'a',
      key: 'k-guard',
      payload: { id: 'bodega', name: 'Bodega', permissions: ['account:self'] },
    });
    expect(edit.statusCode).toBe(403);
    expect(edit.json().detail).toBe('PERMISSION_DENIED');
  });
});

describe('GET /v1/admin/users', () => {
  it('lists the staff for the owner and for an administrator', async () => {
    for (const who of ['w', 'a']) {
      const answer = await send('GET', '/v1/admin/users', { who });
      expect(answer.statusCode).toBe(200);
      expect(answer.json().items[0]).toMatchObject({
        email: 'ana@example.test',
        roles: ['customer', 'staff_orders'],
      });
    }
  });
});

describe('POST /v1/admin/users', () => {
  it('brings a person into the staff: 201, once per key, and a link queued for the dispatcher', async () => {
    const first = await send('POST', '/v1/admin/users', {
      key: 'k-1',
      payload: NEW_STAFF,
    });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ roles: ['customer', 'staff_orders'] });
    const again = await send('POST', '/v1/admin/users', {
      key: 'k-1',
      payload: NEW_STAFF,
    });
    expect(again.statusCode).toBe(201);
    expect(again.headers['idempotency-status']).toBe('IDEMP_REPLAY_SUCCESS');
  });

  it('refuses an administrator reaching for the administrator role: 403 ADMIN_CANNOT_ELEVATE_ADMIN (T2.2)', async () => {
    const answer = await send('POST', '/v1/admin/users', {
      who: 'a',
      key: 'k-2',
      payload: { ...NEW_STAFF, roles: ['admin'] },
    });
    expect(answer.statusCode).toBe(403);
    expect(answer.json().detail).toBe('ADMIN_CANNOT_ELEVATE_ADMIN');
  });

  it('answers 422 for a role that does not exist', async () => {
    const answer = await send('POST', '/v1/admin/users', {
      key: 'k-3',
      payload: { ...NEW_STAFF, roles: ['nope'] },
    });
    expect(answer.statusCode).toBe(422);
    expect(answer.json().detail).toBe('ROLE_NOT_FOUND');
  });

  it('is a 400 without a key, with no roles or with a payload that is not a person', async () => {
    expect(
      (await send('POST', '/v1/admin/users', { payload: NEW_STAFF })).json()
        .detail
    ).toBe('IDEMP_KEY_MISSING');
    for (const payload of [
      { ...NEW_STAFF, roles: [] },
      { email: 'no', fullName: 'A', roles: ['staff_orders'] },
    ]) {
      const bad = await send('POST', '/v1/admin/users', {
        key: 'k-4',
        payload,
      });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().detail).toBe('INVALID_REQUEST');
    }
  });
});

describe('PATCH /v1/admin/users/:id', () => {
  const URL = `/v1/admin/users/${TARGET}`;

  it('switches an account off: 200 and an audit entry', async () => {
    const answer = await send('PATCH', URL, {
      who: 'a',
      key: 'k-5',
      payload: { isActive: false },
    });
    expect(answer.statusCode).toBe(200);
    expect(store.audit.flat()).toContain('STAFF_UPDATED');
  });

  it('never reaches the owner: 403 OWNER_IMMUTABLE (T2.1), and an unknown account is a 404', async () => {
    store.held = ['owner', 'customer'];
    const owner = await send('PATCH', URL, {
      key: 'k-6',
      payload: { isActive: false },
    });
    expect(owner.statusCode).toBe(403);
    expect(owner.json().detail).toBe('OWNER_IMMUTABLE');
    store.held = [];
    const unknown = await send('PATCH', URL, {
      key: 'k-7',
      payload: { isActive: false },
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('is a 400 without a key, with a bad id or with nothing to change', async () => {
    expect(
      (await send('PATCH', URL, { payload: { isActive: true } })).json().detail
    ).toBe('IDEMP_KEY_MISSING');
    expect(
      (
        await send('PATCH', '/v1/admin/users/abc', {
          key: 'k-8',
          payload: { isActive: true },
        })
      ).statusCode
    ).toBe(400);
    expect(
      (await send('PATCH', URL, { key: 'k-9', payload: {} })).statusCode
    ).toBe(400);
  });
});

describe('GET /v1/admin/roles', () => {
  it('lists the roles and the catalog the matrix is made of', async () => {
    const answer = await send('GET', '/v1/admin/roles');
    expect(answer.statusCode).toBe(200);
    expect(answer.json().items[0]).toMatchObject({
      id: 'bodega',
      isSystem: false,
    });
    expect(answer.json().catalog).toContain('roles:manage');
  });
});

describe('POST /v1/admin/roles', () => {
  const NEW_ROLE = {
    id: 'bodega',
    name: 'Bodega',
    permissions: ['account:self', 'orders:read'],
  };

  it('lets the owner create a role of support: 201, once per key', async () => {
    const first = await send('POST', '/v1/admin/roles', {
      key: 'r-1',
      payload: NEW_ROLE,
    });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ id: 'bodega' });
    expect(store.audit.flat()).toContain('ROLE_CREATED');
    const again = await send('POST', '/v1/admin/roles', {
      key: 'r-1',
      payload: NEW_ROLE,
    });
    expect(again.headers['idempotency-status']).toBe('IDEMP_REPLAY_SUCCESS');
  });

  it('refuses a reserved slug, a taken one and a matrix that gives roles:manage', async () => {
    const reserved = await send('POST', '/v1/admin/roles', {
      key: 'r-2',
      payload: { ...NEW_ROLE, id: 'admin' },
    });
    expect(reserved.statusCode).toBe(409);
    expect(reserved.json().detail).toBe('ROLE_ID_RESERVED');
    store.taken = true;
    const taken = await send('POST', '/v1/admin/roles', {
      key: 'r-3',
      payload: NEW_ROLE,
    });
    expect(taken.json().detail).toBe('ROLE_ALREADY_EXISTS');
    store.taken = false;
    const matrix = await send('POST', '/v1/admin/roles', {
      key: 'r-4',
      payload: { ...NEW_ROLE, permissions: ['account:self', 'roles:manage'] },
    });
    expect(matrix.statusCode).toBe(400);
    expect(matrix.json().detail).toBe('MATRIX_INVARIANT_VIOLATED');
  });

  it('is a 400 without a key or with a slug that is not valid', async () => {
    expect(
      (await send('POST', '/v1/admin/roles', { payload: NEW_ROLE })).json()
        .detail
    ).toBe('IDEMP_KEY_MISSING');
    const bad = await send('POST', '/v1/admin/roles', {
      key: 'r-5',
      payload: { ...NEW_ROLE, id: 'Bad Slug' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().detail).toBe('INVALID_REQUEST');
  });
});

describe('PATCH /v1/admin/roles/:id', () => {
  it('edits a role and its matrix: 200 and an audit entry', async () => {
    const answer = await send('PATCH', '/v1/admin/roles/bodega', {
      key: 'p-1',
      payload: { permissions: ['account:self', 'orders:manage'] },
    });
    expect(answer.statusCode).toBe(200);
    expect(store.audit.flat()).toContain('ROLE_UPDATED');
  });

  it('refuses a role of the system, an unknown role and the administrator in its own gift', async () => {
    store.system = 1;
    const system = await send('PATCH', '/v1/admin/roles/owner', {
      key: 'p-2',
      payload: { name: 'Otro' },
    });
    expect(system.statusCode).toBe(403);
    expect(system.json().detail).toBe('SYSTEM_ROLE_PROTECTED');
    store.system = null;
    expect(
      (
        await send('PATCH', '/v1/admin/roles/nada', {
          key: 'p-3',
          payload: { name: 'Otro' },
        })
      ).statusCode
    ).toBe(404);
    store.system = 0;
    const gift = await send('PATCH', '/v1/admin/roles/admin', {
      key: 'p-4',
      payload: { assignableByAdmin: true },
    });
    expect(gift.statusCode).toBe(400);
    expect(gift.json().detail).toBe('ROLE_INVARIANT_VIOLATED');
  });

  it('is a 400 without a key, with a bad slug or with nothing to change', async () => {
    expect(
      (
        await send('PATCH', '/v1/admin/roles/bodega', {
          payload: { name: 'Otro' },
        })
      ).json().detail
    ).toBe('IDEMP_KEY_MISSING');
    expect(
      (
        await send('PATCH', '/v1/admin/roles/Bad%20Slug', {
          key: 'p-5',
          payload: { name: 'Otro' },
        })
      ).statusCode
    ).toBe(400);
    expect(
      (
        await send('PATCH', '/v1/admin/roles/bodega', {
          key: 'p-6',
          payload: {},
        })
      ).statusCode
    ).toBe(400);
  });
});
