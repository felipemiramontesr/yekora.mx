import { describe, expect, it } from 'vitest';
import { decryptTotpSecret, tokenHash } from './authCrypto';
import type { Transactional } from './db';
import {
  provisionOwner,
  readOwnerRequest,
  recoverOwner,
} from './ownerProvision';
import { verifyPassword } from './passwords';

const KEY = Buffer.alloc(32, 7);
const NOW = new Date('2026-11-11T18:00:00.000Z');
const DEPS = { totpKey: KEY, now: NOW };
/** A stand-in address: the real one never appears in the repository (T2.3). */
const EMAIL = 'owner@example.test';
const REQUEST = {
  email: EMAIL,
  fullName: 'GrayMan',
  recover: false,
};

interface User {
  id: string;
  email: string;
  hash: string;
  name: string;
  active: number;
}

/** The tables both modes touch, in memory. */
interface Store {
  users: User[];
  roles: [user: string, role: string][];
  sessions: string[];
  devices: string[];
  totp: string[];
  backupCodes: string[];
  resets: {
    user: string;
    hash: string;
    expires: Date;
    consumed: Date | null;
  }[];
  outbox: { type: string; payload: Record<string, string> }[];
  audit: unknown[][];
}

type Handler = (store: Store, params: readonly unknown[]) => unknown;

const without = (list: string[], user: unknown) =>
  list.splice(0, list.length, ...list.filter((entry) => entry !== user));

const HANDLERS: [prefix: string, handler: Handler][] = [
  [
    "SELECT user_id FROM user_roles WHERE role_id = 'owner' FOR UPDATE",
    (s) =>
      s.roles
        .filter(([, role]) => role === 'owner')
        .map(([user_id]) => ({ user_id })),
  ],
  [
    'SELECT id FROM users WHERE email = ? FOR UPDATE',
    (s, p) => s.users.filter((u) => u.email === p[0]).map(({ id }) => ({ id })),
  ],
  [
    'SELECT u.id FROM users u JOIN user_roles r',
    (s, p) =>
      s.users
        .filter(
          (u) =>
            u.email === p[0] &&
            s.roles.some(([user, role]) => user === u.id && role === 'owner')
        )
        .map(({ id }) => ({ id })),
  ],
  [
    'UPDATE users SET full_name = ?, is_active = 1',
    (s, p) => {
      const user = s.users.find((u) => u.id === p[1]) as User;
      user.name = p[0] as string;
      user.active = 1;
    },
  ],
  [
    'UPDATE users SET is_active = 1',
    (s, p) => {
      (s.users.find((u) => u.id === p[0]) as User).active = 1;
    },
  ],
  [
    'INSERT INTO users',
    (s, p) => {
      const [id, email, hash, name] = p as string[];
      s.users.push({ id, email, hash, name, active: 1 });
    },
  ],
  [
    'INSERT IGNORE INTO user_roles',
    (s, p) => {
      if (!s.roles.some(([user, role]) => user === p[0] && role === 'owner'))
        s.roles.push([p[0] as string, 'owner']);
    },
  ],
  ['DELETE FROM user_sessions', (s, p) => without(s.sessions, p[0])],
  ['DELETE FROM user_trusted_devices', (s, p) => without(s.devices, p[0])],
  ['DELETE FROM two_factor_auth', (s, p) => without(s.totp, p[0])],
  [
    'DELETE FROM two_factor_backup_codes',
    (s, p) => without(s.backupCodes, p[0]),
  ],
  [
    'UPDATE password_reset_tokens SET consumed_at',
    (s, p) => {
      for (const reset of s.resets)
        if (reset.user === p[1] && reset.consumed === null)
          reset.consumed = p[0] as Date;
    },
  ],
  [
    'INSERT INTO password_reset_tokens',
    (s, p) => {
      const [user, hash, expires] = p as [string, string, Date];
      s.resets.push({ user, hash, expires, consumed: null });
    },
  ],
  [
    'INSERT INTO outbox_events',
    (s, p) => {
      s.outbox.push({
        type: p[0] as string,
        payload: JSON.parse(p[1] as string),
      });
    },
  ],
  ['INSERT INTO audit_log', (s, p) => s.audit.push([...p])],
];

function emptyStore(): Store {
  return {
    users: [],
    roles: [],
    sessions: [],
    devices: [],
    totp: [],
    backupCodes: [],
    resets: [],
    outbox: [],
    audit: [],
  };
}

/**
 * A database over a {@link Store}: a transaction works on a copy and replaces the store only
 * when it resolves, so a failed run leaves nothing behind, as MariaDB would.
 *
 * @param failOn - A statement prefix that throws, to stand for a failed write.
 */
function fakeDb(
  store: Store,
  failOn?: string
): Transactional & { store: Store } {
  const db = {
    store,
    async transaction<T>(
      work: (tx: {
        query<Row>(sql: string, params?: readonly unknown[]): Promise<Row[]>;
      }) => Promise<T>
    ) {
      const draft = structuredClone(db.store);
      const result = await work({
        query<Row>(sql: string, params: readonly unknown[] = []) {
          if (failOn !== undefined && sql.startsWith(failOn))
            return Promise.reject(new Error('write failed'));
          const found = HANDLERS.find(([prefix]) => sql.startsWith(prefix));
          if (!found) return Promise.reject(new Error(`no handler: ${sql}`));
          const rows = found[1](draft, params);
          return Promise.resolve((Array.isArray(rows) ? rows : []) as Row[]);
        },
      });
      db.store = draft;
      return result;
    },
  };
  return db;
}

/** A store with one account holding the given roles and some access to end. */
function storeWith(roles: string[], email = EMAIL): Store {
  const store = emptyStore();
  store.users.push({
    id: 'u-1',
    email,
    hash: '$argon2id$old',
    name: 'Ana',
    active: 0,
  });
  store.roles.push(...roles.map((role): [string, string] => ['u-1', role]));
  store.sessions.push('u-1', 'u-2');
  store.devices.push('u-1', 'u-2');
  store.totp.push('u-1', 'u-2');
  store.backupCodes.push('u-1', 'u-1', 'u-2');
  store.resets.push({
    user: 'u-1',
    hash: 'a'.repeat(64),
    expires: NOW,
    consumed: null,
  });
  return store;
}

/** The token of the one link queued, as its mail will carry it. */
function mailedToken(store: Store, userId: string): string {
  const [event] = store.outbox;
  expect(store.outbox).toHaveLength(1);
  expect(event.type).toBe('PASSWORD_RESET');
  expect(event.payload.userId).toBe(userId);
  return decryptTotpSecret(KEY, userId, event.payload.token).toString('utf8');
}

describe('readOwnerRequest (T1.1a and T1.1b, gate E)', () => {
  it('reads the e-mail in canonical form, GrayMan by default and the provision mode', () => {
    expect(readOwnerRequest({ OWNER_EMAIL: 'Owner@Example.TEST' }, [])).toEqual(
      REQUEST
    );
  });

  it('takes the name from OWNER_FULL_NAME and the recovery mode from the flag or OWNER_RECOVER=1', () => {
    const env = { OWNER_EMAIL: EMAIL, OWNER_FULL_NAME: ' Ω ' };
    expect(readOwnerRequest(env, ['--recover'])).toEqual({
      email: EMAIL,
      fullName: 'Ω',
      recover: true,
    });
    expect(readOwnerRequest({ ...env, OWNER_RECOVER: '1' }, [])?.recover).toBe(
      true
    );
  });

  it('answers null for a missing or malformed e-mail, or an unknown mode (OWNER_ENV_INVALID)', () => {
    expect(readOwnerRequest({}, [])).toBeNull();
    expect(readOwnerRequest({ OWNER_EMAIL: 'not-an-address' }, [])).toBeNull();
    expect(
      readOwnerRequest({ OWNER_EMAIL: EMAIL, OWNER_RECOVER: 'yes' }, [])
    ).toBeNull();
  });
});

describe('provisionOwner (T1.1a, T2.2, T2.3)', () => {
  it('creates the owner with a hash nobody can match, mails a 15-minute link and audits without personal data', async () => {
    const db = fakeDb(emptyStore());
    expect(await provisionOwner(db, REQUEST, DEPS)).toBe('OWNER_PROVISIONED');
    const [user] = db.store.users;
    expect(user).toMatchObject({ email: EMAIL, name: 'GrayMan', active: 1 });
    expect(user.hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    // T2.2: no password opens the account, not the empty one nor its own e-mail.
    expect(await verifyPassword(user.hash, '')).toBe(false);
    expect(await verifyPassword(user.hash, EMAIL)).toBe(false);
    expect(db.store.roles).toEqual([[user.id, 'owner']]);
    const token = mailedToken(db.store, user.id);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(db.store.resets).toEqual([
      {
        user: user.id,
        hash: tokenHash(token),
        expires: new Date(NOW.getTime() + 15 * 60_000),
        consumed: null,
      },
    ]);
    expect(db.store.audit).toEqual([
      [
        user.id,
        'OWNER_PROVISIONED',
        'users',
        user.id,
        null,
        JSON.stringify({ role: 'owner', created: true }),
        null,
      ],
    ]);
    // T2.3: neither the address nor the name reaches the trail or the outbox payload.
    const written = JSON.stringify([db.store.audit, db.store.outbox]);
    expect(written).not.toContain(EMAIL);
    expect(written).not.toContain('GrayMan');
  });

  it('promotes the buyer who already has the e-mail: same id and password, new name, no session nor remembered device left', async () => {
    const db = fakeDb(storeWith(['customer']));
    expect(await provisionOwner(db, REQUEST, DEPS)).toBe('OWNER_PROVISIONED');
    expect(db.store.users).toEqual([
      {
        id: 'u-1',
        email: EMAIL,
        hash: '$argon2id$old',
        name: 'GrayMan',
        active: 1,
      },
    ]);
    expect(db.store.roles).toEqual([
      ['u-1', 'customer'],
      ['u-1', 'owner'],
    ]);
    expect(db.store.sessions).toEqual(['u-2']);
    expect(db.store.devices).toEqual(['u-2']);
    mailedToken(db.store, 'u-1');
    expect(db.store.audit[0][5]).toBe(
      JSON.stringify({ role: 'owner', created: false })
    );
  });

  it('refuses when an account already holds owner, whatever the e-mail, and changes nothing', async () => {
    const before = storeWith(['owner'], 'other@example.test');
    const db = fakeDb(structuredClone(before));
    expect(await provisionOwner(db, REQUEST, DEPS)).toBe(
      'OWNER_ALREADY_EXISTS'
    );
    expect(db.store).toEqual(before);
  });

  it('leaves no partial account, link nor mail when a write fails (OWNER_PROVISION_TX_FAILED)', async () => {
    const db = fakeDb(emptyStore(), 'INSERT INTO audit_log');
    await expect(provisionOwner(db, REQUEST, DEPS)).rejects.toThrow(
      'write failed'
    );
    expect(db.store).toEqual(emptyStore());
  });
});

describe('recoverOwner (T1.1b, T2.4)', () => {
  const RECOVER = { ...REQUEST, recover: true };

  it('clears the second factor, ends sessions and devices, spends the open links and mails a new one', async () => {
    const db = fakeDb(storeWith(['owner']));
    expect(await recoverOwner(db, RECOVER, DEPS)).toBe(
      'OWNER_RECOVERY_DISPATCHED'
    );
    const { store } = db;
    // The name and the password stay: only access is reset.
    expect(store.users[0]).toMatchObject({
      hash: '$argon2id$old',
      name: 'Ana',
      active: 1,
    });
    expect(store.totp).toEqual(['u-2']);
    expect(store.backupCodes).toEqual(['u-2']);
    expect(store.sessions).toEqual(['u-2']);
    expect(store.devices).toEqual(['u-2']);
    const token = mailedToken(store, 'u-1');
    expect(store.resets).toEqual([
      { user: 'u-1', hash: 'a'.repeat(64), expires: NOW, consumed: NOW },
      {
        user: 'u-1',
        hash: tokenHash(token),
        expires: new Date(NOW.getTime() + 15 * 60_000),
        consumed: null,
      },
    ]);
    expect(store.audit).toEqual([
      [
        'u-1',
        'OWNER_RECOVERY_DISPATCHED',
        'users',
        'u-1',
        null,
        JSON.stringify({ secondFactorCleared: true, sessionsRevoked: true }),
        null,
      ],
    ]);
  });

  it('refuses an e-mail that is not the owner’s, even of an existing account, and changes nothing', async () => {
    const before = storeWith(['customer', 'admin']);
    const db = fakeDb(structuredClone(before));
    expect(await recoverOwner(db, RECOVER, DEPS)).toBe('OWNER_NOT_FOUND');
    expect(db.store).toEqual(before);
    const unknown = fakeDb(storeWith(['owner'], 'other@example.test'));
    expect(await recoverOwner(unknown, RECOVER, DEPS)).toBe('OWNER_NOT_FOUND');
  });

  it('keeps the owner as it was when a write fails (OWNER_RECOVERY_TX_FAILED)', async () => {
    const before = storeWith(['owner']);
    const db = fakeDb(structuredClone(before), 'INSERT INTO outbox_events');
    await expect(recoverOwner(db, RECOVER, DEPS)).rejects.toThrow(
      'write failed'
    );
    expect(db.store).toEqual(before);
  });
});
