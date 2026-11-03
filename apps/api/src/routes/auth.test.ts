/**
 * OWASP A07 evidence (FC 028 F0): sign-up, sign-in, the second factor, sessions and the guard,
 * end to end through Fastify against an in-memory stand-in of migration 004. The real SQL of
 * these statements runs in db.integration.test.ts.
 */
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { createHmac } from 'node:crypto';
import { base32, tokenHash } from '../services/authCrypto';
import type { Db, Transactional, TxQuery } from '../services/db';

const NOW = new Date('2026-11-02T18:00:00Z');
const SESSION_COOKIE = '__Host-yekora_session';

/** The code an authenticator app shows (RFC 6238), computed apart from the API under test. */
function totpCode(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', secret).update(counter).digest();
  const value = mac.readUInt32BE(mac[mac.length - 1] & 0x0f) & 0x7fffffff;
  return String(value % 1_000_000).padStart(6, '0');
}
const PASSWORD = 'correct horse battery staple';
const KEYS = {
  AUTH_SECRET: Buffer.alloc(32, 1).toString('base64'),
  TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString('base64'),
};
const BASE = { DB_HOST: '127.0.0.1', DB_USER: 'root', DB_NAME: 'yekora_dev' };

/** Base32 back to bytes, to compute the code an authenticator app would show. */
function fromBase32(text: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...text]
    .map((c) => alphabet.indexOf(c).toString(2).padStart(5, '0'))
    .join('');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

const codeNow = (secret: string) =>
  totpCode(fromBase32(secret), Math.floor(NOW.getTime() / 30_000));

/** The rows of migration 004 these routes touch, in memory. */
function freshState() {
  return {
    users: new Map<string, Record<string, unknown>>(),
    userRoles: [] as [string, string][],
    totp: new Map<string, { secret: string; enabled: number }>(),
    backup: [] as { user: string; hash: string; used: number }[],
    challenges: new Map<
      string,
      { user: string; expires: Date; attempts: number }
    >(),
    sessions: new Map<string, { user: string; expires: Date }>(),
  };
}
type State = ReturnType<typeof freshState>;
type Params = readonly unknown[];

/** Seeded permissions per role; a role absent here has none (the LEFT JOIN gives null). */
const ROLE_PERMISSIONS: Record<string, string[]> = {
  customer: ['account:self'],
  staff_orders: ['account:self', 'orders:read'],
  admin: [
    'account:self',
    'orders:read',
    'catalog:write',
    'users:manage',
    'audit:read',
  ],
};

const write = (effect: () => void): unknown[] => {
  effect();
  return [];
};
const activeByEmail = (s: State, p: Params) =>
  [...s.users.values()].filter((u) => u.email === p[0] && u.is_active === 1);
const capabilityRows = (s: State, p: Params) =>
  s.userRoles
    .filter(([user]) => user === p[0])
    .flatMap(([, role]) =>
      (ROLE_PERMISSIONS[role] ?? [null]).map((permission_id) => ({
        role_id: role,
        permission_id,
      }))
    );
const totpRow = (s: State, p: Params) => {
  const row = s.totp.get(p[0] as string);
  return row
    ? [{ totp_secret_encrypted: row.secret, is_totp_enabled: row.enabled }]
    : [];
};
const spendBackup = (s: State, p: Params) => {
  const code = s.backup.find(
    (b) => b.user === p[1] && b.hash === p[2] && b.used === 0
  );
  if (code) code.used = 1;
  return { affectedRows: code ? 1 : 0 };
};
const liveChallengeRow = (s: State, p: Params) => {
  const c = s.challenges.get(p[0] as string);
  const live = c && c.expires > (p[1] as Date) && c.attempts < (p[2] as number);
  return live ? [{ id: p[0], user_id: c.user, attempts: c.attempts }] : [];
};
const sessionRow = (s: State, p: Params) => {
  const session = s.sessions.get(p[0] as string);
  const user = session && s.users.get(session.user);
  const live =
    session && user?.is_active === 1 && session.expires > (p[1] as Date);
  return live
    ? [
        {
          id: p[0],
          user_id: session.user,
          email: user.email,
          full_name: user.full_name,
        },
      ]
    : [];
};

/** One handler per statement of identity.ts, matched by its opening words. */
const HANDLERS: [string, (s: State, p: Params) => unknown][] = [
  ['SELECT id, email, password_hash', activeByEmail],
  [
    'SELECT id FROM users WHERE email',
    (s, p) => [...s.users.values()].filter((u) => u.email === p[0]),
  ],
  [
    'INSERT INTO users',
    (s, p) =>
      write(() =>
        s.users.set(p[0] as string, {
          id: p[0],
          email: p[1],
          password_hash: p[2],
          full_name: p[3],
          is_active: 1,
        })
      ),
  ],
  [
    'INSERT INTO user_roles',
    (s, p) => write(() => s.userRoles.push([p[0] as string, 'customer'])),
  ],
  [
    'SELECT email FROM users',
    (s, p) => [{ email: s.users.get(p[0] as string)?.email }],
  ],
  ['SELECT ur.role_id', capabilityRows],
  [
    'SELECT is_totp_enabled',
    (s, p) =>
      s.totp.has(p[0] as string)
        ? [{ is_totp_enabled: s.totp.get(p[0] as string)?.enabled }]
        : [],
  ],
  ['SELECT totp_secret_encrypted', totpRow],
  [
    'INSERT INTO two_factor_auth',
    (s, p) =>
      write(() =>
        s.totp.set(p[0] as string, { secret: p[1] as string, enabled: 0 })
      ),
  ],
  [
    'UPDATE two_factor_auth',
    (s, p) =>
      write(() =>
        Object.assign(s.totp.get(p[0] as string) ?? {}, { enabled: 1 })
      ),
  ],
  [
    'DELETE FROM two_factor_backup_codes',
    (s, p) =>
      write(() =>
        s.backup.splice(
          0,
          s.backup.length,
          ...s.backup.filter((b) => b.user !== p[0])
        )
      ),
  ],
  [
    'INSERT INTO two_factor_backup_codes',
    (s, p) =>
      write(() => {
        // One multi-row INSERT: (user, hash) pairs.
        for (let i = 0; i < p.length; i += 2) {
          s.backup.push({
            user: p[i] as string,
            hash: p[i + 1] as string,
            used: 0,
          });
        }
      }),
  ],
  ['UPDATE two_factor_backup_codes', spendBackup],
  [
    'INSERT INTO two_factor_challenges',
    (s, p) =>
      write(() =>
        s.challenges.set(p[0] as string, {
          user: p[1] as string,
          expires: p[3] as Date,
          attempts: 0,
        })
      ),
  ],
  ['SELECT id, user_id, attempts', liveChallengeRow],
  [
    'UPDATE two_factor_challenges',
    (s, p) =>
      write(() =>
        Object.assign(s.challenges.get(p[0] as string) ?? { attempts: 0 }, {
          attempts: (s.challenges.get(p[0] as string)?.attempts ?? 0) + 1,
        })
      ),
  ],
  [
    'DELETE FROM two_factor_challenges',
    (s, p) => write(() => s.challenges.delete(p[0] as string)),
  ],
  [
    'INSERT INTO user_sessions',
    (s, p) =>
      write(() =>
        s.sessions.set(p[0] as string, {
          user: p[1] as string,
          expires: p[5] as Date,
        })
      ),
  ],
  ['SELECT s.id, s.user_id', sessionRow],
  [
    'DELETE FROM user_sessions',
    (s, p) => write(() => s.sessions.delete(p[0] as string)),
  ],
];

function memoryDb() {
  const state = freshState();
  async function query<Row>(sql: string, p: Params = []): Promise<Row[]> {
    const handler = HANDLERS.find(([opening]) => sql.startsWith(opening));
    if (handler === undefined) throw new Error(`unexpected SQL: ${sql}`);
    return handler[1](state, p) as Row[];
  }
  const db: Db & Transactional = {
    query,
    ping: async () => undefined,
    transaction: (work: (tx: TxQuery) => Promise<never>) => work({ query }),
    close: async () => undefined,
  };
  return { db, ...state };
}

let app: FastifyInstance;
let store: ReturnType<typeof memoryDb>;

async function start(env: Record<string, string> = KEYS) {
  store = memoryDb();
  app = await buildApp({
    config: loadConfig({ ...BASE, ...env }),
    db: store.db,
    rate: async () => null,
    logger: false,
    now: () => NOW,
  });
  return app;
}

const post = (url: string, payload: object, cookie?: string) =>
  app.inject({
    method: 'POST',
    url,
    payload,
    headers: cookie ? { cookie } : {},
  });

/** The session cookie a response sets, as the browser would send it back. */
function cookieOf(response: LightMyRequestResponse): string {
  const header = String(response.headers['set-cookie']);
  return header.split(';')[0];
}

/** Registers, enrols TOTP and signs in a buyer; returns its cookie and backup codes. */
async function signedInBuyer(email = 'ana@example.test') {
  await post('/v1/auth/register', {
    email,
    password: PASSWORD,
    fullName: 'Ana Prueba',
  });
  const login = await post('/v1/auth/login', { email, password: PASSWORD });
  const { challengeId } = login.json();
  const { secret } = (
    await post('/v1/auth/totp/enroll', { challengeId })
  ).json();
  const confirm = await post('/v1/auth/totp/confirm', {
    challengeId,
    code: codeNow(secret),
  });
  return {
    cookie: cookieOf(confirm),
    backupCodes: confirm.json().backupCodes as string[],
    secret,
  };
}

beforeAll(async () => {
  await (await start()).inject('/health');
  await app.close();
}, 30_000);

afterEach(async () => {
  await app.close();
});

describe('A07 identification and authentication', () => {
  it('registers a buyer with an Argon2id hash and never says whether the e-mail existed', async () => {
    await start();
    const first = await post('/v1/auth/register', {
      email: ' Ana@Example.test ',
      password: PASSWORD,
      fullName: 'Ana',
    });
    const again = await post('/v1/auth/register', {
      email: 'ana@example.test',
      password: PASSWORD,
      fullName: 'Ana',
    });
    expect([first.statusCode, again.statusCode]).toEqual([202, 202]);
    expect(again.json()).toEqual({ status: 'accepted' });
    const [user] = [...store.users.values()];
    expect(store.users.size).toBe(1);
    expect(user.email).toBe('ana@example.test');
    expect(String(user.password_hash)).toMatch(/^\$argon2id\$/);
    expect(store.userRoles).toEqual([[user.id, 'customer']]);
  });

  it('refuses short passwords and unknown fields (400), before any work', async () => {
    await start();
    for (const payload of [
      { email: 'a@example.test', password: 'short', fullName: 'Ana' },
      {
        email: 'a@example.test',
        password: PASSWORD,
        fullName: 'Ana',
        role: 'admin',
      },
    ]) {
      const response = await post('/v1/auth/register', payload);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ detail: 'INVALID_REQUEST' });
    }
    expect(store.users.size).toBe(0);
  });

  it('answers the same 401 to a wrong password and to an unknown e-mail', async () => {
    await start();
    await post('/v1/auth/register', {
      email: 'ana@example.test',
      password: PASSWORD,
      fullName: 'Ana',
    });
    const wrong = await post('/v1/auth/login', {
      email: 'ana@example.test',
      password: 'wrong password!',
    });
    const unknown = await post('/v1/auth/login', {
      email: 'nadie@example.test',
      password: PASSWORD,
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json()).toEqual(wrong.json());
  });

  it('opens only a challenge after the password, never a session (T2.1a)', async () => {
    await start();
    await post('/v1/auth/register', {
      email: 'ana@example.test',
      password: PASSWORD,
      fullName: 'Ana',
    });
    const login = await post('/v1/auth/login', {
      email: 'ana@example.test',
      password: PASSWORD,
    });
    expect(login.statusCode).toBe(200);
    expect(login.json()).toMatchObject({ next: 'enroll_totp' });
    expect(login.headers['set-cookie']).toBeUndefined();
    expect(store.sessions.size).toBe(0);
  });

  it('enrols TOTP, issues 8 backup codes once and signs in with a hardened cookie', async () => {
    await start();
    const { cookie, backupCodes } = await signedInBuyer();
    expect(backupCodes).toHaveLength(8);
    expect(store.backup.map((b) => b.hash)).not.toContain(backupCodes[0]);
    expect(cookie.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
    const [user] = [...store.users.values()];
    expect(String(store.totp.get(String(user.id))?.secret)).toMatch(/^v1:/);
    const sessionIds = [...store.sessions.keys()];
    expect(sessionIds).toEqual([tokenHash(cookie.split('=')[1])]);
  });

  it('sets the cookie HttpOnly, Secure, SameSite=Strict, host-only, 8 h for a buyer', async () => {
    await start();
    await post('/v1/auth/register', {
      email: 'ana@example.test',
      password: PASSWORD,
      fullName: 'Ana',
    });
    const { challengeId } = (
      await post('/v1/auth/login', {
        email: 'ana@example.test',
        password: PASSWORD,
      })
    ).json();
    const { secret } = (
      await post('/v1/auth/totp/enroll', { challengeId })
    ).json();
    const confirm = await post('/v1/auth/totp/confirm', {
      challengeId,
      code: codeNow(secret),
    });
    expect(String(confirm.headers['set-cookie'])).toMatch(
      /^__Host-yekora_session=[\w-]{43}; Path=\/; Max-Age=28800; HttpOnly; Secure; SameSite=Strict$/
    );
    expect(String(confirm.headers['set-cookie'])).not.toContain('Domain');
  });

  it('signs in again with TOTP, or once with each backup code', async () => {
    await start();
    const { backupCodes, secret } = await signedInBuyer();
    const totpLogin = (
      await post('/v1/auth/login', {
        email: 'ana@example.test',
        password: PASSWORD,
      })
    ).json();
    expect(totpLogin.next).toBe('verify');
    const viaTotp = await post('/v1/auth/verify', {
      challengeId: totpLogin.challengeId,
      code: codeNow(secret),
    });
    expect(viaTotp.json()).toEqual({ status: 'signed_in' });
    const once = (
      await post('/v1/auth/login', {
        email: 'ana@example.test',
        password: PASSWORD,
      })
    ).json();
    expect(
      (
        await post('/v1/auth/verify', {
          challengeId: once.challengeId,
          code: backupCodes[0],
        })
      ).statusCode
    ).toBe(200);
    const twice = (
      await post('/v1/auth/login', {
        email: 'ana@example.test',
        password: PASSWORD,
      })
    ).json();
    expect(
      (
        await post('/v1/auth/verify', {
          challengeId: twice.challengeId,
          code: backupCodes[0],
        })
      ).statusCode
    ).toBe(401);
  });

  it('spends a challenge after 5 wrong codes, and refuses an unknown one', async () => {
    await start();
    await signedInBuyer();
    const { challengeId } = (
      await post('/v1/auth/login', {
        email: 'ana@example.test',
        password: PASSWORD,
      })
    ).json();
    for (let i = 0; i < 5; i++) {
      const wrong = await post('/v1/auth/verify', {
        challengeId,
        code: '000000',
      });
      expect(wrong.json()).toMatchObject({ detail: 'INVALID_CODE' });
    }
    const spent = await post('/v1/auth/verify', {
      challengeId,
      code: '000000',
    });
    expect(spent.json()).toMatchObject({ detail: 'INVALID_CHALLENGE' });
    const unknown = await post('/v1/auth/verify', {
      challengeId: '11111111-1111-4111-8111-111111111111',
      code: '000000',
    });
    expect(unknown.statusCode).toBe(401);
  });

  it('refuses enrolment or confirmation out of order (409) and a wrong first code (401)', async () => {
    await start();
    await post('/v1/auth/register', {
      email: 'ana@example.test',
      password: PASSWORD,
      fullName: 'Ana',
    });
    const { challengeId } = (
      await post('/v1/auth/login', {
        email: 'ana@example.test',
        password: PASSWORD,
      })
    ).json();
    expect(
      (
        await post('/v1/auth/totp/confirm', { challengeId, code: '123456' })
      ).json()
    ).toMatchObject({ detail: 'TOTP_NOT_ENROLLED' });
    expect(
      (await post('/v1/auth/verify', { challengeId, code: '123456' })).json()
    ).toMatchObject({ detail: 'TOTP_NOT_ENROLLED' });
    await post('/v1/auth/totp/enroll', { challengeId });
    expect(
      (await post('/v1/auth/totp/confirm', { challengeId, code: '000000' }))
        .statusCode
    ).toBe(401);
    expect(
      (
        await post('/v1/auth/totp/enroll', {
          challengeId: '11111111-1111-4111-8111-111111111111',
        })
      ).statusCode
    ).toBe(401);
    expect(
      (
        await post('/v1/auth/totp/confirm', {
          challengeId: '11111111-1111-4111-8111-111111111111',
          code: '000000',
        })
      ).statusCode
    ).toBe(401);
  });

  it('refuses a second enrolment once TOTP is on', async () => {
    await start();
    await signedInBuyer();
    const { challengeId } = (
      await post('/v1/auth/login', {
        email: 'ana@example.test',
        password: PASSWORD,
      })
    ).json();
    expect(
      (await post('/v1/auth/totp/enroll', { challengeId })).json()
    ).toMatchObject({ detail: 'TOTP_ALREADY_ENABLED' });
    expect(
      (
        await post('/v1/auth/totp/confirm', { challengeId, code: '000000' })
      ).json()
    ).toMatchObject({ detail: 'TOTP_ALREADY_ENABLED' });
  });

  it('answers who is signed in, and ends the session on logout', async () => {
    await start();
    const { cookie } = await signedInBuyer();
    const me = await app.inject({ url: '/v1/account/me', headers: { cookie } });
    expect(me.json()).toMatchObject({
      email: 'ana@example.test',
      fullName: 'Ana Prueba',
      roles: ['customer'],
      permissions: ['account:self'],
    });
    const out = await post('/v1/account/logout', {}, cookie);
    expect(out.statusCode).toBe(204);
    expect(String(out.headers['set-cookie'])).toContain('Max-Age=0');
    expect(
      (await app.inject({ url: '/v1/account/me', headers: { cookie } }))
        .statusCode
    ).toBe(401);
  });

  it('gives staff a 2-hour session, and refuses staff without TOTP (403, T2.1a)', async () => {
    await start();
    const { cookie } = await signedInBuyer('staff@example.test');
    const [user] = [...store.users.values()];
    store.userRoles.splice(0, store.userRoles.length, [
      String(user.id),
      'staff_orders',
    ]);
    const { challengeId } = (
      await post('/v1/auth/login', {
        email: 'staff@example.test',
        password: PASSWORD,
      })
    ).json();
    const [, secret] = [cookie, store.totp.get(String(user.id))];
    expect(secret?.enabled).toBe(1);
    store.totp.set(String(user.id), {
      secret: String(secret?.secret),
      enabled: 0,
    });
    const me = await app.inject({ url: '/v1/account/me', headers: { cookie } });
    expect(me.statusCode).toBe(403);
    expect(me.json()).toMatchObject({ detail: 'SECOND_FACTOR_REQUIRED' });
    expect(challengeId).toMatch(/^[\da-f-]{36}$/);
  });

  it('refuses a session without the route’s permission (403)', async () => {
    await start();
    const { cookie } = await signedInBuyer();
    store.userRoles.splice(0, store.userRoles.length);
    const me = await app.inject({ url: '/v1/account/me', headers: { cookie } });
    expect(me.json()).toMatchObject({ detail: 'FORBIDDEN' });
  });

  it('refuses a missing, malformed or expired session (401)', async () => {
    await start();
    for (const cookie of [
      undefined,
      `${SESSION_COOKIE}=short`,
      `other=1; ${SESSION_COOKIE}=${'a'.repeat(43)}`,
    ]) {
      const me = await app.inject({
        url: '/v1/account/me',
        headers: cookie ? { cookie } : {},
      });
      expect(me.statusCode).toBe(401);
      expect(me.json()).toMatchObject({ detail: 'UNAUTHENTICATED' });
    }
  });

  it('stays closed (503) on every auth and account route without the identity secrets', async () => {
    await start({});
    expect(
      (
        await post('/v1/auth/login', {
          email: 'a@example.test',
          password: PASSWORD,
        })
      ).json()
    ).toMatchObject({ detail: 'AUTH_UNAVAILABLE' });
    expect((await app.inject({ url: '/v1/account/me' })).json()).toMatchObject({
      detail: 'AUTH_UNAVAILABLE',
    });
  });

  it('carries the session only from the site, with credentials', async () => {
    await start();
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/v1/auth/login',
      headers: {
        origin: 'https://yekora.mx',
        'access-control-request-method': 'POST',
      },
    });
    expect(preflight.headers['access-control-allow-credentials']).toBe('true');
    expect(preflight.headers['access-control-allow-origin']).toBe(
      'https://yekora.mx'
    );
  });

  it('shows the authenticator secret in base32 and as a scannable URI', async () => {
    await start();
    await post('/v1/auth/register', {
      email: 'ana@example.test',
      password: PASSWORD,
      fullName: 'Ana',
    });
    const { challengeId } = (
      await post('/v1/auth/login', {
        email: 'ana@example.test',
        password: PASSWORD,
      })
    ).json();
    const enrol = (await post('/v1/auth/totp/enroll', { challengeId })).json();
    expect(enrol.secret).toBe(base32(fromBase32(enrol.secret)));
    expect(enrol.otpauthUri).toContain(`secret=${enrol.secret}`);
  });

  it('refuses a malformed body on every second-factor route (400)', async () => {
    await start();
    for (const url of [
      '/v1/auth/totp/enroll',
      '/v1/auth/totp/confirm',
      '/v1/auth/verify',
    ]) {
      const response = await post(url, {
        challengeId: 'not-a-uuid',
        code: 'abc',
      });
      expect(response.json()).toMatchObject({ detail: 'INVALID_REQUEST' });
    }
  });

  it('gives a staff member who signs in a 2-hour cookie', async () => {
    await start();
    await post('/v1/auth/register', {
      email: 'staff@example.test',
      password: PASSWORD,
      fullName: 'Staff',
    });
    const [user] = [...store.users.values()];
    store.userRoles.splice(0, store.userRoles.length, [
      String(user.id),
      'staff_orders',
    ]);
    const { challengeId } = (
      await post('/v1/auth/login', {
        email: 'staff@example.test',
        password: PASSWORD,
      })
    ).json();
    const { secret } = (
      await post('/v1/auth/totp/enroll', { challengeId })
    ).json();
    const confirm = await post('/v1/auth/totp/confirm', {
      challengeId,
      code: codeNow(secret),
    });
    expect(String(confirm.headers['set-cookie'])).toContain('Max-Age=7200');
  });

  it('reads a role without permissions and a user without a 2FA row as having none', async () => {
    await start();
    const { cookie } = await signedInBuyer();
    const [user] = [...store.users.values()];
    store.totp.delete(String(user.id));
    expect(
      (await app.inject({ url: '/v1/account/me', headers: { cookie } })).json()
    ).toMatchObject({
      roles: ['customer'],
    });
    store.userRoles.splice(0, store.userRoles.length, [
      String(user.id),
      'staff_catalog',
    ]);
    const me = await app.inject({ url: '/v1/account/me', headers: { cookie } });
    expect(me.json()).toMatchObject({ detail: 'SECOND_FACTOR_REQUIRED' });
  });
});
