/**
 * OWASP A07 evidence (FC 028 F0–F1): sign-up, sign-in, the mailed code, the authenticator,
 * sessions and the guard, end to end through Fastify against an in-memory stand-in of migration
 * 004. Mail is queued in the outbox and sent by the dispatcher to a recording sender. The real
 * SQL of these statements runs in db.integration.test.ts.
 */
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { createHash, createHmac } from 'node:crypto';
import { sha1 } from 'hash-wasm';
import { base32, decryptTotpSecret, tokenHash } from '../services/authCrypto';
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
// Meets the policy of FC 042 (12+ characters, the four classes, nothing personal or common).
const PASSWORD = 'Correct horse 7 battery';
const TOTP_KEY = Buffer.alloc(32, 2);
const KEYS = {
  AUTH_SECRET: Buffer.alloc(32, 1).toString('base64'),
  TOTP_ENCRYPTION_KEY: TOTP_KEY.toString('base64'),
};
const MAIL = {
  SMTP_HOST: 'smtp.example.test',
  SMTP_PORT: '465',
  SMTP_USER: 'no-reply@example.test',
  SMTP_PASSWORD: 'mailbox password',
  MAIL_FROM: 'YĒKORA <no-reply@example.test>',
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
      {
        user: string;
        type: string;
        hash: string;
        expires: Date;
        attempts: number;
      }
    >(),
    sessions: new Map<string, { user: string; expires: Date }>(),
    outbox: [] as {
      id: number;
      type: string;
      payload: string;
      status: string;
    }[],
    nonces: new Set<string>(),
    devices: [] as { user: string; hash: string; expires: Date }[],
    // FC 042 (migration 007) and the audit entries of a reset.
    resets: [] as {
      id: number;
      user: string;
      hash: string;
      expires: Date;
      consumed: Date | null;
    }[],
    audit: [] as Params[],
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
  return live
    ? [
        {
          id: p[0],
          user_id: c.user,
          challenge_type: c.type,
          code_hash: c.hash,
          attempts: c.attempts,
        },
      ]
    : [];
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
const spendNonce = (s: State, p: Params) => {
  const fresh = !s.nonces.has(p[0] as string);
  s.nonces.add(p[0] as string);
  return { affectedRows: fresh ? 1 : 0 };
};
const trustedRow = (s: State, p: Params) =>
  s.devices
    .filter(
      (d) => d.hash === p[0] && d.user === p[1] && d.expires > (p[2] as Date)
    )
    .map(() => ({ id: 1 }));
const forgetRow = (s: State, p: Params) =>
  write(() =>
    s.devices.splice(
      0,
      s.devices.length,
      ...s.devices.filter((d) => !(d.hash === p[0] && d.user === p[1]))
    )
  );
const liveResetRow = (s: State, p: Params) =>
  s.resets
    .filter(
      (r) =>
        r.hash === p[0] &&
        r.consumed === null &&
        r.expires > (p[1] as Date) &&
        s.users.get(r.user)?.is_active === 1
    )
    .map((r) => ({
      id: r.id,
      user_id: r.user,
      email: s.users.get(r.user)?.email,
      full_name: s.users.get(r.user)?.full_name,
    }));
const spendReset = (s: State, p: Params) => {
  const reset = s.resets.find((r) => r.id === p[1] && r.consumed === null);
  if (reset) reset.consumed = p[0] as Date;
  return { affectedRows: reset ? 1 : 0 };
};
const claimOutbox = (s: State, p: Params) => {
  const row = s.outbox.find((r) => r.id === p[1] && r.status === 'PENDING');
  if (row) row.status = 'PROCESSING';
  return { affectedRows: row ? 1 : 0 };
};

/** One handler per statement of identity.ts and the outbox, matched by its opening words. */
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
          email_verified_at: null,
        })
      ),
  ],
  [
    'UPDATE users SET email_verified_at',
    (s, p) =>
      write(() => {
        const user = s.users.get(p[1] as string) ?? {};
        user.email_verified_at ??= p[0];
      }),
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
      write(() =>
        s.backup.push({ user: p[0] as string, hash: p[1] as string, used: 0 })
      ),
  ],
  ['UPDATE two_factor_backup_codes', spendBackup],
  [
    'INSERT INTO two_factor_challenges',
    (s, p) =>
      write(() =>
        s.challenges.set(p[0] as string, {
          user: p[1] as string,
          type: p[2] as string,
          hash: p[3] as string,
          expires: p[4] as Date,
          attempts: 0,
        })
      ),
  ],
  ['SELECT id, user_id, challenge_type', liveChallengeRow],
  [
    'UPDATE two_factor_challenges SET challenge_type',
    (s, p) =>
      write(() =>
        Object.assign(s.challenges.get(p[1] as string) ?? {}, {
          type: 'TOTP',
          hash: p[0],
        })
      ),
  ],
  [
    'UPDATE two_factor_challenges SET attempts',
    (s, p) =>
      write(() => {
        const challenge = s.challenges.get(p[0] as string);
        if (challenge) challenge.attempts += 1;
      }),
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
    'DELETE FROM user_sessions WHERE user_id',
    (s, p) =>
      write(() => {
        for (const [id, session] of s.sessions) {
          if (session.user === p[0]) s.sessions.delete(id);
        }
      }),
  ],
  [
    'INSERT INTO password_reset_tokens',
    (s, p) =>
      write(() =>
        s.resets.push({
          id: s.resets.length + 1,
          user: p[0] as string,
          hash: p[1] as string,
          expires: p[2] as Date,
          consumed: null,
        })
      ),
  ],
  ['SELECT t.id, t.user_id', liveResetRow],
  ['UPDATE password_reset_tokens SET consumed_at = ? WHERE id', spendReset],
  [
    'UPDATE password_reset_tokens SET consumed_at = ? WHERE user_id',
    (s, p) =>
      write(() => {
        for (const r of s.resets) {
          if (r.user === p[1] && r.consumed === null) r.consumed = p[0] as Date;
        }
      }),
  ],
  [
    'UPDATE users SET password_hash',
    (s, p) =>
      write(() =>
        Object.assign(s.users.get(p[1] as string) ?? {}, {
          password_hash: p[0],
        })
      ),
  ],
  ['INSERT INTO audit_log', (s, p) => write(() => s.audit.push(p))],
  [
    'DELETE FROM user_sessions',
    (s, p) => write(() => s.sessions.delete(p[0] as string)),
  ],
  [
    'INSERT INTO outbox_events',
    (s, p) =>
      write(() =>
        s.outbox.push({
          id: s.outbox.length + 1,
          type: p[0] as string,
          payload: p[1] as string,
          status: 'PENDING',
        })
      ),
  ],
  ["UPDATE outbox_events SET status = 'PENDING'", () => []],
  ['DELETE FROM auth_challenge_nonces', () => []],
  ['INSERT IGNORE INTO auth_challenge_nonces', spendNonce],
  [
    'INSERT INTO user_trusted_devices',
    (s, p) =>
      write(() =>
        s.devices.push({
          user: p[0] as string,
          hash: p[1] as string,
          expires: p[2] as Date,
        })
      ),
  ],
  ['SELECT id FROM user_trusted_devices', trustedRow],
  ['DELETE FROM user_trusted_devices', forgetRow],
  [
    'SELECT id, event_type, payload',
    (s) =>
      s.outbox
        .filter((r) => r.status === 'PENDING')
        .map((r) => ({
          id: r.id,
          event_type: r.type,
          payload: r.payload,
          retry_count: 0,
          max_retries: 5,
        })),
  ],
  ["UPDATE outbox_events SET status = 'PROCESSING'", claimOutbox],
  [
    "UPDATE outbox_events SET status = 'SENT'",
    (s, p) =>
      write(() =>
        Object.assign(s.outbox.find((r) => r.id === p[1]) ?? {}, {
          status: 'SENT',
        })
      ),
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
let sent: { to: string; subject: string; text: string }[];
/** Every pause `forgot-password` asked for (FC 042 T2.1), instead of waiting for real. */
let waits: number[];
/**
 * What the stand-in of Pwned Passwords answers (FC 042 Enmienda 2): by default a valid range
 * that lists no password of these tests. CI never reaches HIBP.
 */
let pwned: { status: number; body: string };
/** Every range URL the API asked the stand-in for. */
let pwnedAsked: string[];
const pwnedFetch: typeof fetch = async (url) => {
  pwnedAsked.push(String(url));
  return new Response(pwned.body, { status: pwned.status });
};

async function start(
  env: Record<string, string> = { ...KEYS, ...MAIL },
  now: () => Date = () => NOW
) {
  store = memoryDb();
  sent = [];
  waits = [];
  pwned = { status: 200, body: `${'0'.repeat(35)}:0\r\n` };
  pwnedAsked = [];
  app = await buildApp({
    config: loadConfig({ ...BASE, ...env }),
    db: store.db,
    rate: async () => null,
    logger: false,
    now,
    sendMail: async (message) => {
      sent.push(message);
    },
    wait: async (ms) => {
      waits.push(ms);
    },
    pwnedFetch,
  });
  return app;
}

/** Solves the anti-bot challenge as the browser does: tries numbers until the hash matches. */
async function solved(): Promise<string> {
  const challenge = (await app.inject('/v1/auth/bot-challenge')).json<{
    algorithm: string;
    challenge: string;
    maxnumber: number;
    salt: string;
    signature: string;
  }>();
  const sha = (value: string) =>
    createHash('sha256').update(value).digest('hex');
  let number = 0;
  while (sha(`${challenge.salt}${number}`) !== challenge.challenge) number += 1;
  return Buffer.from(JSON.stringify({ ...challenge, number })).toString(
    'base64'
  );
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

async function register(email: string, fullName = 'Ana Prueba') {
  return post('/v1/auth/register', {
    email,
    password: PASSWORD,
    fullName,
    altcha: await solved(),
  });
}

/** A login request with a fresh solved challenge. */
async function loginAs(email: string, password = PASSWORD, cookie?: string) {
  return post(
    '/v1/auth/login',
    { email, password, altcha: await solved() },
    cookie
  );
}

async function login(email: string) {
  return (await loginAs(email)).json<{
    challengeId: string;
    next: string;
    channel: string;
  }>();
}

/** The code a challenge mailed, read from its queued (encrypted) message. */
function mailedCode(challengeId: string): string {
  const row = store.outbox.find(
    (r) => r.type === 'SIGN_IN_CODE' && r.payload.includes(challengeId)
  );
  const { code } = JSON.parse(String(row?.payload)) as { code: string };
  return decryptTotpSecret(TOTP_KEY, challengeId, code).toString('utf8');
}

/** Gives the only registered user one role instead of customer. */
function makeOnly(role: string) {
  const [user] = [...store.users.values()];
  store.userRoles.splice(0, store.userRoles.length, [String(user.id), role]);
  return String(user.id);
}

/** Registers and signs in a buyer with the mailed code; returns its cookie. */
async function signedInBuyer(email = 'ana@example.test') {
  await register(email);
  const { challengeId } = await login(email);
  const verify = await post('/v1/auth/verify', {
    challengeId,
    code: mailedCode(challengeId),
  });
  return { cookie: cookieOf(verify), verify };
}

/** Registers staff, passes the mailed code and enrols the authenticator; signed in. */
async function signedInStaff(email = 'staff@example.test') {
  await register(email, 'Staff');
  makeOnly('staff_orders');
  const { challengeId } = await login(email);
  await post('/v1/auth/verify', { challengeId, code: mailedCode(challengeId) });
  const { secret } = (
    await post('/v1/auth/totp/enroll', { challengeId })
  ).json<{ secret: string }>();
  const confirm = await post('/v1/auth/totp/confirm', {
    challengeId,
    code: codeNow(secret),
  });
  return {
    cookie: cookieOf(confirm),
    confirm,
    backupCodes: confirm.json<{ backupCodes: string[] }>().backupCodes,
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

// Each test chains several Argon2id hashes (sign-up and sign-ins), slow on purpose (OWASP
// profile); on a busy machine a few of them pass 5 s, so the block has its own budget.
describe('A07 identification and authentication', { timeout: 20_000 }, () => {
  it('OWASP-A07 · registers a buyer with an Argon2id hash and never says whether the e-mail existed', async () => {
    await start();
    const first = await register(' Ana@Example.test ', 'Ana');
    const again = await register('ana@example.test', 'Ana');
    expect([first.statusCode, again.statusCode]).toEqual([202, 202]);
    expect(again.json()).toEqual({ status: 'accepted' });
    const [user] = [...store.users.values()];
    expect(store.users.size).toBe(1);
    expect(user.email).toBe('ana@example.test');
    expect(String(user.password_hash)).toMatch(/^\$argon2id\$/);
    expect(store.userRoles).toEqual([[user.id, 'customer']]);
  });

  it('OWASP-A07 · refuses unknown fields (400), before any work', async () => {
    await start();
    const response = await post('/v1/auth/register', {
      email: 'a@example.test',
      password: PASSWORD,
      fullName: 'Ana',
      role: 'admin',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ detail: 'INVALID_REQUEST' });
    expect(store.users.size).toBe(0);
  });

  it.each([
    ['too short', 'Ruta-Neva7#', 'PASSWORD_LENGTH'],
    ['without a symbol', 'RutaNevado7Sur', 'PASSWORD_SYMBOL'],
    ['with the name in it', 'Prueba-Nevado7#', 'PASSWORD_PERSONAL'],
    ['common', 'Password123!x', 'PASSWORD_COMMON'],
  ])(
    'OWASP-A07 · refuses a password %s with the code of its rule, and creates nothing (FC 042 T2.6)',
    async (_case, password, code) => {
      await start();
      const response = await post('/v1/auth/register', {
        email: 'ana@example.test',
        password,
        fullName: 'Ana Prueba',
        altcha: await solved(),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ detail: code });
      expect(store.users.size).toBe(0);
    }
  );

  it('OWASP-A07 · answers the same 401 to a wrong password and to an unknown e-mail', async () => {
    await start();
    await register('ana@example.test');
    const wrong = await loginAs('ana@example.test', 'wrong password!');
    const unknown = await loginAs('nadie@example.test');
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json()).toEqual(wrong.json());
  });

  it('OWASP-A07 · opens only a challenge after the password, and queues its code in the same transaction (T2.1a, T2.4b)', async () => {
    await start();
    await register('ana@example.test');
    const response = await loginAs('ana@example.test');
    expect(response.statusCode).toBe(200);
    const { challengeId, ...rest } = response.json();
    expect(rest).toEqual({ next: 'verify', channel: 'email' });
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(store.sessions.size).toBe(0);
    const [queued] = store.outbox;
    expect(queued.type).toBe('SIGN_IN_CODE');
    // Ids and ciphertext only: no address, no code in clear.
    const payload = JSON.parse(queued.payload) as Record<string, string>;
    expect(Object.keys(payload).sort()).toEqual([
      'challengeId',
      'code',
      'userId',
    ]);
    expect(payload.challengeId).toBe(challengeId);
    expect(payload.code).toMatch(/^v1:/);
    expect(queued.payload).not.toContain(mailedCode(challengeId));
    expect(queued.payload).not.toContain('@');
  });

  it('OWASP-A07 · mails the code after the answer, through the dispatcher (T1.3, T2.4a)', async () => {
    await start();
    await register('ana@example.test');
    const { challengeId } = await login('ana@example.test');
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      to: 'ana@example.test',
      subject: 'Tu código de acceso a YĒKORA',
    });
    expect(sent[0].text).toContain(mailedCode(challengeId));
    expect(store.outbox[0].status).toBe('SENT');
  });

  it('OWASP-A07 · signs a buyer in with the mailed code: hardened 8 h cookie, e-mail verified', async () => {
    await start();
    const { cookie, verify } = await signedInBuyer();
    expect(verify.json()).toEqual({ status: 'signed_in' });
    expect(String(verify.headers['set-cookie'])).toMatch(
      /^__Host-yekora_session=[\w-]{43}; Path=\/; Max-Age=28800; HttpOnly; Secure; SameSite=Strict$/
    );
    expect(String(verify.headers['set-cookie'])).not.toContain('Domain');
    expect([...store.sessions.keys()]).toEqual([
      tokenHash(cookie.split('=')[1]),
    ]);
    const [user] = [...store.users.values()];
    expect(user.email_verified_at).toEqual(NOW);
  });

  it('OWASP-A07 · counts a wrong mailed code against the challenge, and spends it after 5 (T1.1 T)', async () => {
    await start();
    await register('ana@example.test');
    const { challengeId } = await login('ana@example.test');
    const right = mailedCode(challengeId);
    const wrong = right === '000000' ? '111111' : '000000';
    for (const code of [wrong, wrong, wrong, wrong, '12345678']) {
      const response = await post('/v1/auth/verify', { challengeId, code });
      expect(response.json()).toMatchObject({ detail: 'INVALID_CODE' });
    }
    const spent = await post('/v1/auth/verify', { challengeId, code: right });
    expect(spent.json()).toMatchObject({ detail: 'INVALID_CHALLENGE' });
    expect(store.sessions.size).toBe(0);
  });

  it('OWASP-A07 · makes staff prove the mailbox before enrolling the authenticator, then signs in for 2 h (T2.1a)', async () => {
    await start();
    await register('staff@example.test', 'Staff');
    makeOnly('staff_orders');
    const { challengeId } = await login('staff@example.test');
    // Before the mailed code, the authenticator cannot be enrolled with this challenge.
    for (const [url, payload] of [
      ['/v1/auth/totp/enroll', { challengeId }],
      ['/v1/auth/totp/confirm', { challengeId, code: '000000' }],
    ] as const) {
      expect((await post(url, payload)).json()).toMatchObject({
        detail: 'INVALID_CHALLENGE',
      });
    }
    const passed = await post('/v1/auth/verify', {
      challengeId,
      code: mailedCode(challengeId),
    });
    expect(passed.statusCode).toBe(409);
    expect(passed.json()).toMatchObject({ detail: 'TOTP_NOT_ENROLLED' });
    expect(passed.headers['set-cookie']).toBeUndefined();
    // Still no authenticator: neither confirm nor verify can sign in yet.
    for (const url of ['/v1/auth/totp/confirm', '/v1/auth/verify']) {
      expect(
        (await post(url, { challengeId, code: '000000' })).json()
      ).toMatchObject({ detail: 'TOTP_NOT_ENROLLED' });
    }
    const { secret } = (
      await post('/v1/auth/totp/enroll', { challengeId })
    ).json<{ secret: string }>();
    expect(
      (await post('/v1/auth/totp/confirm', { challengeId, code: '000000' }))
        .statusCode
    ).toBe(401);
    const confirm = await post('/v1/auth/totp/confirm', {
      challengeId,
      code: codeNow(secret),
    });
    const { backupCodes } = confirm.json<{ backupCodes: string[] }>();
    expect(backupCodes).toHaveLength(8);
    expect(store.backup.map((b) => b.hash)).not.toContain(backupCodes[0]);
    expect(String(confirm.headers['set-cookie'])).toContain('Max-Age=7200');
    const [user] = [...store.users.values()];
    expect(String(store.totp.get(String(user.id))?.secret)).toMatch(/^v1:/);
  });

  it('OWASP-A07 · queues the security alert with the authenticator, and mails it', async () => {
    await start();
    await signedInStaff();
    expect(store.outbox.map((r) => r.type)).toEqual([
      'SIGN_IN_CODE',
      'TOTP_ENABLED',
    ]);
    await vi.waitFor(() => expect(sent).toHaveLength(2), { timeout: 5000 });
    expect(sent[1]).toMatchObject({
      to: 'staff@example.test',
      subject: 'Activaste la verificación en dos pasos en YĒKORA',
    });
  });

  it('OWASP-A07 · signs staff in again with the authenticator, or once with each backup code', async () => {
    await start();
    const { backupCodes, secret } = await signedInStaff();
    const again = await login('staff@example.test');
    expect(again.channel).toBe('authenticator');
    const viaTotp = await post('/v1/auth/verify', {
      challengeId: again.challengeId,
      code: codeNow(secret),
    });
    expect(viaTotp.json()).toEqual({ status: 'signed_in' });
    const once = await login('staff@example.test');
    expect(
      (
        await post('/v1/auth/verify', {
          challengeId: once.challengeId,
          code: backupCodes[0],
        })
      ).statusCode
    ).toBe(200);
    const twice = await login('staff@example.test');
    expect(
      (
        await post('/v1/auth/verify', {
          challengeId: twice.challengeId,
          code: backupCodes[0],
        })
      ).statusCode
    ).toBe(401);
  });

  it('OWASP-A07 · spends an authenticator challenge after 5 wrong codes, and refuses an unknown one', async () => {
    await start();
    await signedInStaff();
    const { challengeId } = await login('staff@example.test');
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
    const unknown = '11111111-1111-4111-8111-111111111111';
    for (const [url, payload] of [
      ['/v1/auth/verify', { challengeId: unknown, code: '000000' }],
      ['/v1/auth/totp/enroll', { challengeId: unknown }],
      ['/v1/auth/totp/confirm', { challengeId: unknown, code: '000000' }],
    ] as const) {
      expect((await post(url, payload)).statusCode).toBe(401);
    }
  });

  it('OWASP-A07 · refuses a second enrolment once the authenticator is on', async () => {
    await start();
    await signedInStaff();
    const { challengeId } = await login('staff@example.test');
    expect(
      (await post('/v1/auth/totp/enroll', { challengeId })).json()
    ).toMatchObject({ detail: 'TOTP_ALREADY_ENABLED' });
    expect(
      (
        await post('/v1/auth/totp/confirm', { challengeId, code: '000000' })
      ).json()
    ).toMatchObject({ detail: 'TOTP_ALREADY_ENABLED' });
  });

  it('OWASP-A07 · answers who is signed in, and ends the session on logout', async () => {
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

  it('OWASP-A07 · refuses staff whose authenticator is off (403, T2.1a)', async () => {
    await start();
    const { cookie } = await signedInStaff();
    const [user] = [...store.users.values()];
    Object.assign(store.totp.get(String(user.id)) ?? {}, { enabled: 0 });
    const me = await app.inject({ url: '/v1/account/me', headers: { cookie } });
    expect(me.statusCode).toBe(403);
    expect(me.json()).toMatchObject({ detail: 'SECOND_FACTOR_REQUIRED' });
  });

  it('OWASP-A07 · refuses a session without the route’s permission (403)', async () => {
    await start();
    const { cookie } = await signedInBuyer();
    store.userRoles.splice(0, store.userRoles.length);
    const me = await app.inject({ url: '/v1/account/me', headers: { cookie } });
    expect(me.json()).toMatchObject({ detail: 'PERMISSION_DENIED' });
  });

  it('OWASP-A07 · refuses a missing, malformed or expired session (401)', async () => {
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
      expect(me.json()).toMatchObject({ detail: 'SESSION_INVALID_OR_EXPIRED' });
    }
  });

  it('OWASP-A07 · stays closed (503) on every auth and account route without the identity secrets', async () => {
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

  it('OWASP-A07 · answers 503 MAIL_UNAVAILABLE without the SMTP account, but lets the authenticator in', async () => {
    await start(KEYS);
    await register('ana@example.test');
    const byMail = await loginAs('ana@example.test');
    expect(byMail.statusCode).toBe(503);
    expect(byMail.json()).toMatchObject({ detail: 'MAIL_UNAVAILABLE' });
    const [user] = [...store.users.values()];
    store.totp.set(String(user.id), { secret: 'v1:a:b:c', enabled: 1 });
    expect((await login('ana@example.test')).channel).toBe('authenticator');
  });

  it('OWASP-A07 · keeps the security alert queued while the SMTP account is missing', async () => {
    await start(KEYS);
    await register('staff@example.test', 'Staff');
    const userId = makeOnly('staff_orders');
    // The mailbox was proved earlier; the challenge waits for the authenticator now.
    store.challenges.set('22222222-2222-4222-8222-222222222222', {
      user: userId,
      type: 'TOTP',
      hash: '0'.repeat(64),
      expires: new Date(NOW.getTime() + 60_000),
      attempts: 0,
    });
    const challengeId = '22222222-2222-4222-8222-222222222222';
    const { secret } = (
      await post('/v1/auth/totp/enroll', { challengeId })
    ).json<{ secret: string }>();
    const confirm = await post('/v1/auth/totp/confirm', {
      challengeId,
      code: codeNow(secret),
    });
    expect(confirm.statusCode).toBe(200);
    expect(store.outbox.map((r) => [r.type, r.status])).toEqual([
      ['TOTP_ENABLED', 'PENDING'],
    ]);
    expect(sent).toEqual([]);
  });

  it('OWASP-A07 · carries the session only from the site, with credentials', async () => {
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

  it('OWASP-A07 · shows the authenticator secret in base32 and as a scannable URI', async () => {
    await start();
    await register('staff@example.test', 'Staff');
    makeOnly('admin');
    const { challengeId } = await login('staff@example.test');
    await post('/v1/auth/verify', {
      challengeId,
      code: mailedCode(challengeId),
    });
    const enrol = (await post('/v1/auth/totp/enroll', { challengeId })).json();
    expect(enrol.secret).toBe(base32(fromBase32(enrol.secret)));
    expect(enrol.otpauthUri).toContain(`secret=${enrol.secret}`);
  });

  it('OWASP-A07 · refuses a malformed body on every second-factor route (400)', async () => {
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

  it('OWASP-A07 · reads a role without permissions and a user without a 2FA row as having none', async () => {
    await start();
    const { cookie } = await signedInBuyer();
    expect(
      (await app.inject({ url: '/v1/account/me', headers: { cookie } })).json()
    ).toMatchObject({
      roles: ['customer'],
    });
    makeOnly('staff_catalog');
    const me = await app.inject({ url: '/v1/account/me', headers: { cookie } });
    expect(me.json()).toMatchObject({ detail: 'SECOND_FACTOR_REQUIRED' });
  });
});

describe(
  'anti-bot challenge (FC 028 Enmienda 1, E1: T1.4, T2.8a–e)',
  { timeout: 20_000 },
  () => {
    it('hands out an ALTCHA-format challenge of difficulty 20 000 that expires in 5 minutes, never cached', async () => {
      await start();
      const response = await app.inject('/v1/auth/bot-challenge');
      expect(response.headers['cache-control']).toBe('no-store');
      const challenge = response.json<{ maxnumber: number; salt: string }>();
      expect(challenge).toMatchObject({
        algorithm: 'SHA-256',
        maxnumber: 20_000,
      });
      const expires = Number(
        new URLSearchParams(challenge.salt.split('?')[1]).get('expires')
      );
      expect(expires * 1000 - NOW.getTime()).toBe(5 * 60_000);
    });

    it('refuses register and login without a solution (BOT_CHALLENGE_REQUIRED), before any password work (T2.8a)', async () => {
      await start();
      const register = await post('/v1/auth/register', {
        email: 'ana@example.test',
        password: PASSWORD,
        fullName: 'Ana',
      });
      const login = await post('/v1/auth/login', {
        email: 'ana@example.test',
        password: PASSWORD,
      });
      for (const response of [register, login]) {
        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({
          detail: 'BOT_CHALLENGE_REQUIRED',
        });
      }
      expect(store.users.size).toBe(0);
      expect(store.outbox).toEqual([]);
    });

    it('refuses a forged, tampered, malformed or spent solution (BOT_CHALLENGE_FAILED, T2.8b)', async () => {
      await start();
      await register('ana@example.test');
      const good = await solved();
      const decoded = JSON.parse(Buffer.from(good, 'base64').toString());
      const encode = (value: object) =>
        Buffer.from(JSON.stringify(value)).toString('base64');
      const attempts = [
        encode({ ...decoded, number: (decoded.number + 1) % 20_001 }),
        encode({ ...decoded, signature: 'f'.repeat(64) }),
        encode({ ...decoded, salt: `${decoded.salt}x` }),
        encode({ ...decoded, salt: 'no-expiry' }),
        'not base64 json',
        encode({ algorithm: 'SHA-1' }),
      ];
      for (const altcha of attempts) {
        const response = await post('/v1/auth/login', {
          email: 'ana@example.test',
          password: PASSWORD,
          altcha,
        });
        expect(response.json()).toMatchObject({
          detail: 'BOT_CHALLENGE_FAILED',
        });
      }
      const first = await post('/v1/auth/login', {
        email: 'ana@example.test',
        password: PASSWORD,
        altcha: good,
      });
      const replay = await post('/v1/auth/login', {
        email: 'ana@example.test',
        password: PASSWORD,
        altcha: good,
      });
      expect(first.statusCode).toBe(200);
      expect(replay.json()).toMatchObject({ detail: 'BOT_CHALLENGE_FAILED' });
    });

    it('refuses a solution whose 5 minutes are over', async () => {
      store = memoryDb();
      sent = [];
      let clock = NOW;
      app = await buildApp({
        config: loadConfig({ ...BASE, ...KEYS, ...MAIL }),
        db: store.db,
        rate: async () => null,
        logger: false,
        now: () => clock,
        sendMail: async () => undefined,
      });
      const altcha = await solved();
      clock = new Date(NOW.getTime() + 5 * 60_000 + 1000);
      const response = await post('/v1/auth/login', {
        email: 'ana@example.test',
        password: PASSWORD,
        altcha,
      });
      expect(response.json()).toMatchObject({ detail: 'BOT_CHALLENGE_FAILED' });
    });

    it('limits the challenge endpoint to 30 per minute per IP (T2.8e), and closes it without the keys', async () => {
      await start();
      const codes = [];
      for (let i = 0; i < 31; i++) {
        codes.push((await app.inject('/v1/auth/bot-challenge')).statusCode);
      }
      expect(codes.filter((code) => code === 200)).toHaveLength(30);
      expect(codes.at(-1)).toBe(429);
      await app.close();
      await start({});
      expect((await app.inject('/v1/auth/bot-challenge')).json()).toMatchObject(
        {
          detail: 'AUTH_UNAVAILABLE',
        }
      );
    });
  }
);

describe(
  'trusted device (FC 028 Enmienda 1, E2: T1.1 T, T2.9a–d)',
  { timeout: 20_000 },
  () => {
    /** Registers a buyer, passes the mailed code asking to remember the device; its cookies. */
    async function rememberedBuyer(email = 'ana@example.test') {
      await register(email);
      const { challengeId } = await login(email);
      const verify = await post('/v1/auth/verify', {
        challengeId,
        code: mailedCode(challengeId),
        rememberDevice: true,
      });
      const cookies = [verify.headers['set-cookie']].flat().map(String);
      return { verify, cookies, device: cookies[1]?.split(';')[0] };
    }

    it('remembers a buyer’s device for 30 days in a hardened cookie, storing only its SHA-256 (T2.9a, T2.9c)', async () => {
      await start();
      const { cookies, device } = await rememberedBuyer();
      expect(cookies).toHaveLength(2);
      expect(cookies[1]).toMatch(
        /^__Host-yekora_device=[\w-]{43}; Path=\/; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict$/
      );
      const token = String(device).split('=')[1];
      expect(store.devices.map((d) => d.hash)).toEqual([tokenHash(token)]);
      expect(store.devices[0].expires).toEqual(
        new Date(NOW.getTime() + 2_592_000_000)
      );
    });

    it('signs the buyer in after the password alone on that device (201), and asks for the code elsewhere (T1.1 T)', async () => {
      await start();
      const { device } = await rememberedBuyer();
      const trusted = await loginAs(
        'ana@example.test',
        PASSWORD,
        String(device)
      );
      expect(trusted.statusCode).toBe(201);
      expect(trusted.json()).toEqual({ status: 'signed_in' });
      expect(String(trusted.headers['set-cookie'])).toMatch(
        /^__Host-yekora_session=/
      );
      const elsewhere = await loginAs('ana@example.test');
      expect(elsewhere.json()).toMatchObject({
        next: 'verify',
        channel: 'email',
      });
      const forged = await loginAs(
        'ana@example.test',
        PASSWORD,
        `__Host-yekora_device=${'x'.repeat(43)}`
      );
      expect(forged.statusCode).toBe(200);
    });

    it('never lets a device stand in for a wrong password, or for another account', async () => {
      await start();
      const { device } = await rememberedBuyer();
      await register('luis@example.test', 'Luis');
      const wrong = await loginAs(
        'ana@example.test',
        'wrong password!',
        String(device)
      );
      expect(wrong.statusCode).toBe(401);
      const other = await loginAs(
        'luis@example.test',
        PASSWORD,
        String(device)
      );
      expect(other.statusCode).toBe(200);
    });

    it('forgets an expired device on its own: after 30 days the code is asked again', async () => {
      await start();
      const { device } = await rememberedBuyer();
      store.devices[0].expires = new Date(NOW.getTime() - 1);
      const response = await loginAs(
        'ana@example.test',
        PASSWORD,
        String(device)
      );
      expect(response.json()).toMatchObject({ next: 'verify' });
    });

    it('never remembers or honours a device for staff or admin (T2.9b)', async () => {
      await start();
      const { cookie, secret } = await signedInStaff();
      expect(cookie).toMatch(/^__Host-yekora_session=/);
      const again = await login('staff@example.test');
      const verify = await post('/v1/auth/verify', {
        challengeId: again.challengeId,
        code: codeNow(secret),
        rememberDevice: true,
      });
      expect([verify.headers['set-cookie']].flat()).toHaveLength(1);
      expect(store.devices).toEqual([]);
      const [user] = [...store.users.values()];
      store.devices.push({
        user: String(user.id),
        hash: tokenHash('d'.repeat(43)),
        expires: new Date(NOW.getTime() + 60_000),
      });
      const planted = await loginAs(
        'staff@example.test',
        PASSWORD,
        `__Host-yekora_device=${'d'.repeat(43)}`
      );
      expect(planted.json()).toMatchObject({
        next: 'verify',
        channel: 'authenticator',
      });
    });

    it('forgets this device on request: the row goes and the cookie expires (T2.9d)', async () => {
      await start();
      const { cookies, device } = await rememberedBuyer();
      const session = cookies[0].split(';')[0];
      const forget = await post(
        '/v1/account/forget-device',
        {},
        `${session}; ${device}`
      );
      expect(forget.statusCode).toBe(204);
      expect(String(forget.headers['set-cookie'])).toBe(
        '__Host-yekora_device=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict'
      );
      expect(store.devices).toEqual([]);
      const without = await post('/v1/account/forget-device', {}, session);
      expect(without.statusCode).toBe(204);
    });
  }
);

describe(
  'FC 042 · forgot-password and reset-password',
  { timeout: 20_000 },
  () => {
    const NEUTRAL = {
      ok: true,
      message:
        'Si el correo está registrado, enviamos instrucciones para restablecer tu contraseña.',
    };
    const NEW_PASSWORD = 'Glaciar norte 9 ruta';

    /** One request, from its own address unless told: the per-IP limit stays out of the way. */
    let address = 0;
    async function forgot(email: string) {
      address += 1;
      return app.inject({
        method: 'POST',
        url: '/v1/auth/forgot-password',
        payload: { email, altcha: await solved() },
        remoteAddress: `198.51.100.${address % 250}`,
      });
    }

    /** The token of the last reset link queued, decrypted as the dispatcher does. */
    function mailedToken(): string {
      const row = store.outbox.findLast((r) => r.type === 'PASSWORD_RESET');
      const { userId, token } = JSON.parse(String(row?.payload)) as {
        userId: string;
        token: string;
      };
      return decryptTotpSecret(TOTP_KEY, userId, token).toString('utf8');
    }

    it('T1.1 · opens a 15-minute link for an account and queues its mail, storing only the hash', async () => {
      await start();
      await register('ana@example.test');
      const response = await forgot('Ana@Example.test ');
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(NEUTRAL);
      const token = mailedToken();
      expect(token).toMatch(/^[0-9a-f]{64}$/);
      expect(store.resets).toEqual([
        {
          id: 1,
          user: [...store.users.keys()][0],
          hash: tokenHash(token),
          expires: new Date(NOW.getTime() + 15 * 60_000),
          consumed: null,
        },
      ]);
      // The payload carries the ciphertext only, never the token in clear.
      expect(store.outbox.at(-1)?.payload).not.toContain(token);
      await vi.waitFor(() =>
        expect(sent.map((m) => m.subject)).toContain(
          'Restablece tu contraseña de YĒKORA'
        )
      );
      const mail = sent.find((m) => m.subject.startsWith('Restablece'));
      expect(mail?.to).toBe('ana@example.test');
      expect(mail?.text).toContain(
        `https://yekora.mx/cuenta/?action=reset-password&token=${token}`
      );
      expect(mail?.text).toContain(
        `https://yekora.mx/en/account/?action=reset-password&token=${token}`
      );
    });

    it('T2.1 · answers an unknown e-mail the same, after the same least time, and queues nothing', async () => {
      await start();
      await register('ana@example.test');
      const known = await forgot('ana@example.test');
      const unknown = await forgot('nadie@example.test');
      expect([unknown.statusCode, unknown.json()]).toEqual([
        known.statusCode,
        known.json(),
      ]);
      expect(store.resets).toHaveLength(1);
      expect(
        store.outbox.filter((r) => r.type === 'PASSWORD_RESET')
      ).toHaveLength(1);
      // The clock of the test stands still: both answers waited the whole floor.
      expect(waits).toEqual([500, 500]);
    });

    it('T2.1 · really waits out the floor when no pause is injected (production)', async () => {
      store = memoryDb();
      app = await buildApp({
        config: loadConfig({ ...BASE, ...KEYS, ...MAIL }),
        db: store.db,
        rate: async () => null,
        logger: false,
        now: () => NOW,
        sendMail: async () => undefined,
      });
      const started = performance.now();
      const response = await forgot('nadie@example.test');
      expect(response.json()).toEqual(NEUTRAL);
      expect(performance.now() - started).toBeGreaterThanOrEqual(450);
    });

    it('T1.1 V · refuses a request without the anti-bot proof or with a bad e-mail (400)', async () => {
      await start();
      const bot = await post('/v1/auth/forgot-password', {
        email: 'ana@example.test',
      });
      expect(bot.json()).toMatchObject({ detail: 'BOT_CHALLENGE_REQUIRED' });
      const email = await post('/v1/auth/forgot-password', {
        email: 'not-an-email',
      });
      expect([email.statusCode, email.json().detail]).toEqual([
        400,
        'INVALID_REQUEST',
      ]);
      expect(store.resets).toEqual([]);
    });

    it('T1.1 R · gives each e-mail 10 requests a minute (429), whether it has an account or not', async () => {
      let clock = NOW;
      await start(undefined, () => clock);
      for (let i = 0; i < 10; i += 1) {
        expect((await forgot('nadie@example.test')).statusCode).toBe(200);
      }
      const limited = await forgot('NADIE@example.test');
      expect([limited.statusCode, limited.json().detail]).toEqual([
        429,
        'RATE_LIMITED',
      ]);
      expect((await forgot('otra@example.test')).statusCode).toBe(200);
      clock = new Date(NOW.getTime() + 60_000);
      expect((await forgot('nadie@example.test')).statusCode).toBe(200);
    });

    it('answers 503 MAIL_UNAVAILABLE without the SMTP account, and opens no link', async () => {
      await start(KEYS);
      await register('ana@example.test');
      const response = await forgot('ana@example.test');
      expect([response.statusCode, response.json().detail]).toEqual([
        503,
        'MAIL_UNAVAILABLE',
      ]);
      expect(store.resets).toEqual([]);
    });

    it('T1.2, T2.3 · sets the new password, spends every link, ends every session and queues the alert', async () => {
      await start();
      const { cookie } = await signedInBuyer();
      await forgot('ana@example.test');
      const older = mailedToken();
      await forgot('ana@example.test');
      const token = mailedToken();
      const response = await post('/v1/auth/reset-password', {
        token,
        password: NEW_PASSWORD,
      });
      expect([response.statusCode, response.json()]).toEqual([
        200,
        { ok: true },
      ]);
      expect(String(response.headers['set-cookie'])).toContain('Max-Age=0');
      const [user] = [...store.users.values()];
      expect(String(user.password_hash)).toMatch(
        /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/
      );
      expect(
        store.resets.every((r) => r.consumed?.getTime() === NOW.getTime())
      ).toBe(true);
      expect(store.sessions.size).toBe(0);
      expect(
        (await app.inject({ url: '/v1/account/me', headers: { cookie } }))
          .statusCode
      ).toBe(401);
      expect(store.audit).toHaveLength(1);
      expect(store.audit[0].slice(0, 4)).toEqual([
        user.id,
        'PASSWORD_RESET',
        'users',
        user.id,
      ]);
      expect(store.outbox.at(-1)?.type).toBe('PASSWORD_CHANGED');
      // The old password no longer opens the account; the new one does.
      expect((await loginAs('ana@example.test')).statusCode).toBe(401);
      expect((await loginAs('ana@example.test', NEW_PASSWORD)).statusCode).toBe(
        200
      );
      // Every link of the account was spent, the older one too.
      for (const spent of [token, older]) {
        const again = await post('/v1/auth/reset-password', {
          token: spent,
          password: NEW_PASSWORD,
        });
        expect([again.statusCode, again.json().detail]).toEqual([
          400,
          'RESET_TOKEN_INVALID',
        ]);
      }
    });

    it('T1.2 · refuses an unknown or expired link, and a weak password without spending the link', async () => {
      let clock = NOW;
      await start(undefined, () => clock);
      await register('ana@example.test');
      await forgot('ana@example.test');
      const token = mailedToken();
      const weak = await post('/v1/auth/reset-password', {
        token,
        password: 'Ana prueba 7 sol',
      });
      expect([weak.statusCode, weak.json().detail]).toEqual([
        400,
        'PASSWORD_PERSONAL',
      ]);
      expect(store.resets[0].consumed).toBeNull();
      const unknown = await post('/v1/auth/reset-password', {
        token: 'f'.repeat(64),
        password: NEW_PASSWORD,
      });
      expect(unknown.json().detail).toBe('RESET_TOKEN_INVALID');
      clock = new Date(NOW.getTime() + 15 * 60_000);
      const expired = await post('/v1/auth/reset-password', {
        token,
        password: NEW_PASSWORD,
      });
      expect(expired.json().detail).toBe('RESET_TOKEN_INVALID');
      const malformed = await post('/v1/auth/reset-password', {
        token: 'not-hex',
        password: NEW_PASSWORD,
      });
      expect(malformed.json().detail).toBe('INVALID_REQUEST');
    });

    it('T2.3 · lets only one of two submissions of the same link win', async () => {
      await start();
      await register('ana@example.test');
      await forgot('ana@example.test');
      const token = mailedToken();
      // The second submission found the link live, but the first spent it before its update.
      const [reset] = store.resets;
      const original = store.db.transaction;
      store.db.transaction = async (work) => {
        reset.consumed = NOW;
        return original(work);
      };
      const lost = await post('/v1/auth/reset-password', {
        token,
        password: NEW_PASSWORD,
      });
      expect([lost.statusCode, lost.json().detail]).toEqual([
        400,
        'RESET_TOKEN_INVALID',
      ]);
      expect(store.audit).toEqual([]);
    });

    it('T1.5 · names the account of a live link without spending it, never cached', async () => {
      await start();
      await register('ana@example.test', 'Ana Prueba');
      await forgot('ana@example.test');
      const token = mailedToken();
      const check = await post('/v1/auth/reset-password/check', { token });
      expect([check.statusCode, check.json()]).toEqual([
        200,
        { email: 'ana@example.test', fullName: 'Ana Prueba' },
      ]);
      expect(check.headers['cache-control']).toBe('no-store');
      expect(store.resets[0].consumed).toBeNull();
      // The same link still changes the password after being checked.
      const reset = await post('/v1/auth/reset-password', {
        token,
        password: NEW_PASSWORD,
      });
      expect(reset.statusCode).toBe(200);
      const spent = await post('/v1/auth/reset-password/check', { token });
      expect([spent.statusCode, spent.json().detail]).toEqual([
        400,
        'RESET_TOKEN_INVALID',
      ]);
      expect(spent.headers['cache-control']).toBe('no-store');
    });

    it('T1.5 · refuses an unknown, expired or malformed token, and limits each IP to 10 a minute', async () => {
      let clock = NOW;
      await start(undefined, () => clock);
      await register('ana@example.test');
      await forgot('ana@example.test');
      const token = mailedToken();
      const unknown = await post('/v1/auth/reset-password/check', {
        token: 'f'.repeat(64),
      });
      expect(unknown.json().detail).toBe('RESET_TOKEN_INVALID');
      const malformed = await post('/v1/auth/reset-password/check', {
        token: 'not-hex',
      });
      expect([malformed.statusCode, malformed.json().detail]).toEqual([
        400,
        'INVALID_REQUEST',
      ]);
      clock = new Date(NOW.getTime() + 15 * 60_000);
      const expired = await post('/v1/auth/reset-password/check', { token });
      expect(expired.json().detail).toBe('RESET_TOKEN_INVALID');
      // Three asked so far: seven more fill the 10 of this minute, the eleventh is refused.
      const codes = [];
      for (let i = 0; i < 8; i += 1) {
        codes.push(
          (await post('/v1/auth/reset-password/check', { token })).statusCode
        );
      }
      expect(codes).toEqual([400, 400, 400, 400, 400, 400, 400, 429]);
    });

    it('T1.5 · answers 503 without the identity keys', async () => {
      await start({});
      const response = await post('/v1/auth/reset-password/check', {
        token: 'f'.repeat(64),
      });
      expect([response.statusCode, response.json().detail]).toEqual([
        503,
        'AUTH_UNAVAILABLE',
      ]);
    });
  }
);

describe(
  'FC 042 Enmienda 2 · Pwned Passwords range, fail-open (T1.2, T2.6)',
  { timeout: 20_000 },
  () => {
    const NEW_PASSWORD = 'Glaciar norte 9 ruta';

    /** A valid range that lists this password as seen `count` times. */
    async function rangeListing(password: string, count: number) {
      const suffix = (await sha1(password)).toUpperCase().slice(5);
      return `${'0'.repeat(35)}:0\r\n${suffix}:${count}\r\n`;
    }

    /** Opens a reset link for a fresh account; its token. */
    async function liveLink(): Promise<string> {
      await register('ana@example.test');
      await post('/v1/auth/forgot-password', {
        email: 'ana@example.test',
        altcha: await solved(),
      });
      const row = store.outbox.findLast((r) => r.type === 'PASSWORD_RESET');
      const { userId, token } = JSON.parse(String(row?.payload)) as {
        userId: string;
        token: string;
      };
      return decryptTotpSecret(TOTP_KEY, userId, token).toString('utf8');
    }

    it('refuses a breached password at sign-up (400 PASSWORD_BREACHED), sending only the prefix', async () => {
      await start();
      pwned = { status: 200, body: await rangeListing(PASSWORD, 3) };
      const response = await register('ana@example.test');
      expect([response.statusCode, response.json().detail]).toEqual([
        400,
        'PASSWORD_BREACHED',
      ]);
      expect(store.users.size).toBe(0);
      const prefix = (await sha1(PASSWORD)).toUpperCase().slice(0, 5);
      expect(pwnedAsked).toEqual([
        `https://api.pwnedpasswords.com/range/${prefix}`,
      ]);
    });

    it('refuses a breached password at reset without spending the link', async () => {
      await start();
      const token = await liveLink();
      pwned = { status: 200, body: await rangeListing(NEW_PASSWORD, 1) };
      const response = await post('/v1/auth/reset-password', {
        token,
        password: NEW_PASSWORD,
      });
      expect([response.statusCode, response.json().detail]).toEqual([
        400,
        'PASSWORD_BREACHED',
      ]);
      expect(store.resets[0].consumed).toBeNull();
    });

    it('asks the range only for a password the 7 rules accept', async () => {
      await start();
      const response = await post('/v1/auth/register', {
        email: 'ana@example.test',
        password: 'short',
        fullName: 'Ana',
        altcha: await solved(),
      });
      expect(response.json().detail).toBe('PASSWORD_LENGTH');
      expect(pwnedAsked).toEqual([]);
    });

    it.each([
      ['a 5xx', 503, ''],
      ['an empty 200', 200, ''],
      ['a 200 that is not a range', 200, '<html>busy</html>'],
    ])(
      'fails open on %s: the 7 rules alone decide',
      async (_c, status, body) => {
        await start();
        const token = await liveLink();
        pwned = { status, body };
        const response = await post('/v1/auth/reset-password', {
          token,
          password: NEW_PASSWORD,
        });
        expect(response.statusCode).toBe(200);
        expect(pwnedAsked).toHaveLength(2);
      }
    );
  }
);
