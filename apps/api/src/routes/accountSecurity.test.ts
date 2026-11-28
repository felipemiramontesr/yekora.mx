/**
 * FC 079 F0 evidence: the change of password with the rows of T1.1a and T1.1b, once per key without
 * a fast hash of it, what it closes (T2.1), and the sessions and devices of one account only
 * (T1.2, T2.2, T2.4).
 *
 * FC 079 F1 evidence: the second factor with the rows of T1.3, T1.4 and T1.5, what is stored of its
 * secrets (T0.4, T2.3), staff keeping theirs (T2.6) and the owner's recovery (T2.7).
 *
 * The database is an in-memory table of handlers keyed by the start of each statement, so the real
 * guard, routes and services run unchanged.
 */
import { createHash, createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import {
  codeHash,
  decryptTotpSecret,
  encryptTotpSecret,
  newTotpSecret,
  tokenHash,
} from '../services/authCrypto';
import type { Db, Transactional } from '../services/db';
import { hashPassword, verifyPassword } from '../services/passwords';

const KEY = Buffer.alloc(32, 7);
const NOW = new Date('2026-11-28T18:00:00Z');
const ANA = 'f0000000-0000-4000-8000-000000000001';
const LUIS = 'f0000000-0000-4000-8000-000000000002';
const TOKEN = 'a'.repeat(43);
const MINE = tokenHash(TOKEN);
const OTHER_OF_ANA = '1'.repeat(64);
const OF_LUIS = '2'.repeat(64);
const CURRENT = 'Ruta-Nevado7#Sur';
const NEXT = 'Cumbre-Alta9$Norte';

const store = {
  hash: '',
  sessions: [] as { id: string; user_id: string }[],
  devices: [] as { id: number; user_id: string }[],
  mails: [] as unknown[],
  audit: [] as unknown[],
  keys: new Map<string, Record<string, unknown>>(),
  role: 'customer',
  totp: new Map<string, { encrypted: string | null; enabled: number }>(),
  codes: [] as { user_id: string; hash: string; used: boolean }[],
};
let breached = false;
let targetRole = 'customer';

const remove = <T>(list: T[], gone: (item: T) => boolean) => {
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (gone(list[index])) list.splice(index, 1);
  }
};

const created = new Date('2026-11-20T10:00:00Z');

const HANDLERS: [string, (params: readonly unknown[]) => unknown][] = [
  [
    'SELECT s.id, s.user_id',
    (p) =>
      p[0] === MINE
        ? [
            {
              id: MINE,
              user_id: ANA,
              email: 'ana@example.test',
              full_name: 'Ana Prueba',
            },
          ]
        : [],
  ],
  [
    'SELECT ur.role_id',
    (p) => {
      const role = p[0] === ANA ? store.role : targetRole;
      return ['account:self', 'roles:manage']
        .slice(0, role === 'owner' ? 2 : 1)
        .map((permission_id) => ({ role_id: role, permission_id }));
    },
  ],
  [
    'SELECT is_totp_enabled FROM two_factor_auth',
    (p) => {
      const row = store.totp.get(p[0] as string);
      return row ? [{ is_totp_enabled: row.enabled }] : [];
    },
  ],
  [
    'SELECT totp_secret_encrypted',
    (p) => {
      const row = store.totp.get(p[0] as string);
      return row
        ? [
            {
              totp_secret_encrypted: row.encrypted,
              is_totp_enabled: row.enabled,
            },
          ]
        : [];
    },
  ],
  [
    'INSERT INTO two_factor_auth',
    (p) => {
      store.totp.set(p[0] as string, { encrypted: p[1] as string, enabled: 0 });
      return [];
    },
  ],
  [
    'UPDATE two_factor_auth SET is_totp_enabled = 1',
    (p) => {
      const row = store.totp.get(p[0] as string);
      if (row) row.enabled = 1;
      return [];
    },
  ],
  [
    'UPDATE two_factor_auth SET is_totp_enabled = 0',
    (p) => {
      store.totp.set(p[0] as string, { encrypted: null, enabled: 0 });
      return [];
    },
  ],
  [
    'DELETE FROM two_factor_backup_codes',
    (p) => {
      remove(store.codes, (c) => c.user_id === p[0]);
      return [];
    },
  ],
  [
    'INSERT INTO two_factor_backup_codes',
    (p) => {
      store.codes.push({
        user_id: p[0] as string,
        hash: p[1] as string,
        used: false,
      });
      return [];
    },
  ],
  [
    'UPDATE two_factor_backup_codes',
    (p) => {
      const found = store.codes.find(
        (c) => c.user_id === p[1] && c.hash === p[2] && !c.used
      );
      if (found) found.used = true;
      return { affectedRows: found ? 1 : 0 };
    },
  ],
  [
    'SELECT id, email, password_hash',
    (p) => (p[0] === 'luis@example.test' ? [{ id: LUIS }] : []),
  ],
  ['SELECT password_hash FROM users', () => [{ password_hash: store.hash }]],
  [
    'UPDATE users SET password_hash',
    (p) => {
      store.hash = p[0] as string;
      return [];
    },
  ],
  [
    'SELECT id, ip_address, user_agent, created_at FROM user_sessions',
    (p) =>
      store.sessions
        .filter((session) => session.user_id === p[0])
        .map((session) => ({
          ...session,
          ip_address: null,
          user_agent: 'Firefox',
          created_at: created,
        })),
  ],
  [
    'SELECT user_id FROM user_sessions',
    (p) => store.sessions.filter((session) => session.id === p[0]),
  ],
  [
    'DELETE FROM user_sessions WHERE id = ? AND user_id = ?',
    (p) => {
      remove(store.sessions, (s) => s.id === p[0] && s.user_id === p[1]);
      return [];
    },
  ],
  [
    'DELETE FROM user_sessions WHERE user_id = ? AND id <> ?',
    (p) => {
      remove(store.sessions, (s) => s.user_id === p[0] && s.id !== p[1]);
      return [];
    },
  ],
  [
    'DELETE FROM user_sessions WHERE user_id = ?',
    (p) => {
      remove(store.sessions, (s) => s.user_id === p[0]);
      return [];
    },
  ],
  [
    'SELECT id, ip_address, user_agent, created_at, expires_at',
    (p) =>
      store.devices
        .filter((device) => device.user_id === p[0])
        .map((device) => ({
          ...device,
          ip_address: null,
          user_agent: null,
          created_at: created,
          expires_at: NOW,
        })),
  ],
  [
    'SELECT user_id FROM user_trusted_devices',
    (p) => store.devices.filter((device) => device.id === p[0]),
  ],
  [
    'DELETE FROM user_trusted_devices WHERE id = ?',
    (p) => {
      remove(store.devices, (d) => d.id === p[0] && d.user_id === p[1]);
      return [];
    },
  ],
  [
    'DELETE FROM user_trusted_devices WHERE user_id = ?',
    (p) => {
      remove(store.devices, (d) => d.user_id === p[0]);
      return [];
    },
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
    'INSERT INTO outbox_events',
    (p) => {
      store.mails.push(p[0]);
      return [];
    },
  ],
  [
    'INSERT INTO audit_log',
    (p) => {
      store.audit.push(p[1]);
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
let currentHash = '';

beforeAll(async () => {
  currentHash = await hashPassword(CURRENT);
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
    // The k-anonymity service: it knows the suffix of NEXT only when a test says so.
    pwnedFetch: (async () => {
      const digest = createHash('sha1').update(NEXT).digest('hex');
      const suffix = digest.slice(5).toUpperCase();
      return new Response(breached ? `${suffix}:12` : `${'0'.repeat(35)}:1`, {
        status: 200,
      });
    }) as typeof fetch,
  });
  await app.ready();
}, 30_000);

afterAll(async () => {
  await app.close();
});

let address = 0;

/** A documentation address (RFC 5737) per request, so the rate limit counts them apart. */
const nextAddress = () => {
  address += 1;
  return `192.0.2.${address % 250}`;
};

beforeEach(() => {
  breached = false;
  store.hash = currentHash;
  store.sessions = [
    { id: MINE, user_id: ANA },
    { id: OTHER_OF_ANA, user_id: ANA },
    { id: OF_LUIS, user_id: LUIS },
  ];
  store.devices = [
    { id: 1, user_id: ANA },
    { id: 2, user_id: LUIS },
  ];
  store.mails = [];
  store.audit = [];
  store.keys.clear();
  store.role = 'customer';
  store.totp.clear();
  store.codes = [];
  targetRole = 'customer';
});

interface Options {
  key?: string | null;
  payload?: unknown;
  from?: string;
}

/** Each request comes from its own address unless a test says otherwise (the rate limit). */
const send = (
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  { key = null, payload, from }: Options = {}
) =>
  app.inject({
    method,
    url,
    remoteAddress: from ?? nextAddress(),
    headers: {
      cookie: `__Host-yekora_session=${TOKEN}`,
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      ...(key === null ? {} : { 'idempotency-key': key }),
    },
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
  });

const BODY = {
  currentPassword: CURRENT,
  newPassword: NEXT,
  confirmPassword: NEXT,
};
const change = (over: Record<string, string> = {}, key = 'k-1') =>
  send('POST', '/v1/account/password', {
    key,
    payload: { ...BODY, ...over },
  });

describe('POST /v1/account/password (FC 079 T1.1a, T1.1b, T2.1)', () => {
  it('stores the new password, closes the rest, queues the alert and audits it', async () => {
    const answer = await change();
    expect(answer.statusCode).toBe(200);
    expect(answer.json()).toEqual({ success: true });
    expect(await verifyPassword(store.hash, NEXT)).toBe(true);
    expect(store.sessions.map((s) => s.id)).toEqual([MINE, OF_LUIS]);
    expect(store.devices.map((d) => d.id)).toEqual([2]);
    expect(store.mails).toEqual(['PASSWORD_CHANGED']);
    expect(store.audit).toContain('PASSWORD_CHANGED');
  });

  it('answers a repeated request without judging the old password again, and keeps no fast hash of it', async () => {
    await change();
    const again = await change();
    expect(again.statusCode).toBe(200);
    expect(again.headers['idempotency-status']).toBe('IDEMP_REPLAY_SUCCESS');
    expect(store.mails).toHaveLength(1);
    const [kept] = [...store.keys.values()];
    const plain = createHash('sha256')
      .update(JSON.stringify(BODY))
      .digest('hex');
    expect(JSON.stringify(kept)).not.toContain(plain);
    expect(JSON.stringify(kept)).not.toContain(NEXT);
    const other = await change({ newPassword: `${NEXT}x` });
    expect(other.statusCode).toBe(409);
  });

  it.each([
    [{ currentPassword: 'otra' }, 'INVALID_CURRENT_PASSWORD'],
    [{ confirmPassword: 'otra' }, 'PASSWORD_CONFIRMATION_MISMATCH'],
    [
      { newPassword: CURRENT, confirmPassword: CURRENT },
      'PASSWORD_IDENTICAL_TO_CURRENT',
    ],
    [{ newPassword: 'corta', confirmPassword: 'corta' }, 'PASSWORD_LENGTH'],
  ])('refuses %j with %s and changes nothing', async (over, code) => {
    const answer = await change(over);
    expect(answer.statusCode).toBe(400);
    expect(answer.json().detail).toBe(code);
    expect(answer.headers['content-type']).toContain('problem+json');
    expect(store.hash).toBe(currentHash);
    expect(store.keys.size).toBe(0);
    expect(store.audit.includes('PASSWORD_CHANGE_REFUSED')).toBe(
      code === 'INVALID_CURRENT_PASSWORD'
    );
  });

  it('refuses a password of a known breach', async () => {
    breached = true;
    expect((await change()).json().detail).toBe('PASSWORD_BREACHED');
    expect(store.hash).toBe(currentHash);
  });

  it('needs an Idempotency-Key and the three fields', async () => {
    const noKey = await send('POST', '/v1/account/password', {
      payload: BODY,
    });
    expect(noKey.json().detail).toBe('IDEMP_KEY_MISSING');
    const noField = await send('POST', '/v1/account/password', {
      key: 'k-2',
      payload: { currentPassword: CURRENT },
    });
    expect(noField.json().detail).toBe('INVALID_REQUEST');
  });

  it('answers ten tries a minute from one address, no more', async () => {
    const tries = [];
    for (let index = 0; index < 11; index += 1) {
      tries.push(
        send('POST', '/v1/account/password', {
          payload: BODY,
          from: '198.51.100.9',
        })
      );
    }
    const answers = await Promise.all(tries);
    expect(answers.filter((a) => a.statusCode === 429)).toHaveLength(1);
  });
});

describe('the sessions of the account (FC 079 T1.2, T2.2)', () => {
  const close = (id: string) => send('DELETE', `/v1/account/sessions/${id}`);

  it('lists only the account’s, the one asking marked', async () => {
    const answer = await send('GET', '/v1/account/sessions');
    expect(answer.json().items).toEqual([
      expect.objectContaining({ id: MINE, isCurrent: true }),
      expect.objectContaining({ id: OTHER_OF_ANA, isCurrent: false }),
    ]);
  });

  it('closes another session of the account and audits it', async () => {
    const answer = await close(OTHER_OF_ANA);
    expect(answer.json()).toEqual({ success: true });
    expect(store.sessions.map((s) => s.id)).toEqual([MINE, OF_LUIS]);
    expect(store.audit).toContain('SESSION_REVOKED');
  });

  it.each([
    ['one that does not exist', '9'.repeat(64), 404, 'SESSION_NOT_FOUND'],
    ['a wrong id', 'x', 404, 'SESSION_NOT_FOUND'],
    ['the one asking', MINE, 400, 'CANNOT_REVOKE_CURRENT_SESSION'],
    ['someone else’s', OF_LUIS, 403, 'SESSION_FORBIDDEN'],
  ])('refuses %s', async (_case, id, status, code) => {
    const answer = await close(id);
    expect(answer.statusCode).toBe(status);
    expect(answer.json().detail).toBe(code);
    expect(store.sessions).toHaveLength(3);
    expect(store.audit).not.toContain('SESSION_REVOKED');
  });

  it('closes every other session at once, never another account’s', async () => {
    await send('DELETE', '/v1/account/sessions');
    expect(store.sessions.map((s) => s.id)).toEqual([MINE, OF_LUIS]);
    expect(store.audit).toContain('OTHER_SESSIONS_REVOKED');
  });
});

describe('the remembered devices of the account (FC 079 T2.2)', () => {
  const forget = (id: string) => send('DELETE', `/v1/account/devices/${id}`);

  it('lists and forgets one, and all of them', async () => {
    const listed = await send('GET', '/v1/account/devices');
    expect(listed.json().items).toEqual([
      expect.objectContaining({ id: 1, ip: null }),
    ]);
    expect((await forget('1')).statusCode).toBe(200);
    expect(store.devices.map((d) => d.id)).toEqual([2]);
    expect(store.audit).toContain('DEVICE_FORGOTTEN');
    await send('DELETE', '/v1/account/devices');
    expect(store.devices.map((d) => d.id)).toEqual([2]);
    expect(store.audit).toContain('DEVICES_FORGOTTEN');
  });

  it.each([
    ['7', 404, 'DEVICE_NOT_FOUND'],
    ['x', 404, 'DEVICE_NOT_FOUND'],
    ['2', 403, 'DEVICE_FORBIDDEN'],
  ])('refuses the device %s with %i', async (id, status, code) => {
    const answer = await forget(id);
    expect(answer.statusCode).toBe(status);
    expect(answer.json().detail).toBe(code);
    expect(store.devices).toHaveLength(2);
  });
});

const post = (url: string, payload?: unknown, key: string | null = null) =>
  send('POST', url, { key, ...(payload === undefined ? {} : { payload }) });

/** Gives an account an authenticator, on or pending; returns its secret. */
function authenticator(userId: string, enabled = true) {
  const secret = newTotpSecret();
  store.totp.set(userId, {
    encrypted: encryptTotpSecret(KEY, userId, secret),
    enabled: enabled ? 1 : 0,
  });
  return secret;
}

/** The code an authenticator shows now (RFC 6238), computed apart from the API under test. */
function codeNow(secret: Buffer): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(NOW.getTime() / 30_000)));
  const mac = createHmac('sha1', secret).update(counter).digest();
  const value = mac.readUInt32BE(mac[mac.length - 1] & 0x0f) & 0x7fffffff;
  return String(value % 1_000_000).padStart(6, '0');
}
const wrongCode = (secret: Buffer) =>
  codeNow(secret) === '000000' ? '111111' : '000000';

describe('the second factor of the account (FC 079 T1.3, T0.4, T2.3)', () => {
  const setup = () => post('/v1/account/2fa/totp/setup');
  const enable = (code: string) =>
    post('/v1/account/2fa/totp/enable', { code });
  const state = async () => (await send('GET', '/v1/account/2fa')).json();

  it('says it is off and optional for a customer', async () => {
    expect(await state()).toEqual({ enabled: false, mandatory: false });
  });

  it('sets up a pending secret and turns it on with its code, showing eight codes once', async () => {
    const started = await setup();
    expect(started.json().otpauthUri).toContain('otpauth://totp/');
    const kept = store.totp.get(ANA);
    expect(kept?.enabled).toBe(0);
    expect(kept?.encrypted).not.toContain(started.json().secret);
    const secret = decryptTotpSecret(KEY, ANA, kept?.encrypted as string);

    const done = await enable(codeNow(secret));
    const { backupCodes } = done.json();
    expect(backupCodes).toHaveLength(8);
    expect(store.codes.map((c) => c.hash)).toEqual(
      backupCodes.map((code: string) => codeHash(KEY, code))
    );
    expect(await state()).toEqual({ enabled: true, mandatory: false });
    expect(store.devices.map((d) => d.id)).toEqual([2]);
    expect(store.mails).toEqual(['TOTP_ENABLED']);
    expect(store.audit).toContain('TOTP_ENROLLED');
    expect(store.keys.size).toBe(0);
    expect((await enable(codeNow(secret))).json().detail).toBe(
      'TOTP_ALREADY_ENABLED'
    );
  });

  it('never restarts over an active second factor', async () => {
    authenticator(ANA);
    const answer = await setup();
    expect(answer.statusCode).toBe(409);
    expect(answer.json().detail).toBe('TOTP_ALREADY_ENABLED');
    expect(store.totp.get(ANA)?.enabled).toBe(1);
  });

  it('refuses without a setup, with a wrong code or with a malformed one', async () => {
    expect((await enable('123456')).json().detail).toBe('TOTP_NOT_ENROLLED');
    const secret = authenticator(ANA, false);
    expect((await enable(wrongCode(secret))).json().detail).toBe(
      'INVALID_TOTP_CODE'
    );
    expect((await enable('12')).json().detail).toBe('INVALID_TOTP_CODE');
    expect(store.totp.get(ANA)?.enabled).toBe(0);
    expect(store.codes).toHaveLength(0);
  });
});

describe('turning the second factor off (FC 079 T1.4, T2.6)', () => {
  const disable = (code: string, password = CURRENT) =>
    post('/v1/account/2fa/totp/disable', { password, code });

  it('needs the password and takes the code of the authenticator', async () => {
    const secret = authenticator(ANA);
    const done = await disable(codeNow(secret));
    expect(done.json()).toEqual({ success: true });
    expect(store.totp.get(ANA)).toEqual({ encrypted: null, enabled: 0 });
    expect(store.devices.map((d) => d.id)).toEqual([2]);
    expect(store.mails).toEqual(['TOTP_DISABLED']);
    expect(store.audit).toContain('TOTP_DISABLED');
    expect((await disable('123456')).json().detail).toBe('TOTP_NOT_ENABLED');
  });

  it('takes an unused backup code instead', async () => {
    authenticator(ANA);
    store.codes = [
      { user_id: ANA, hash: codeHash(KEY, '12345678'), used: false },
    ];
    expect((await disable('12345678')).statusCode).toBe(200);
    expect(store.codes).toHaveLength(0);
  });

  it('refuses a wrong password, a wrong second factor and a malformed request', async () => {
    const secret = authenticator(ANA);
    expect((await disable(codeNow(secret), 'otra')).json().detail).toBe(
      'INVALID_CURRENT_PASSWORD'
    );
    expect((await disable(wrongCode(secret))).json().detail).toBe(
      'INVALID_2FA_CODE'
    );
    expect((await disable('87654321')).json().detail).toBe('INVALID_2FA_CODE');
    expect((await disable('1')).json().detail).toBe('INVALID_REQUEST');
    expect(store.totp.get(ANA)?.enabled).toBe(1);
    expect(store.audit).toContain('TOTP_DISABLE_REFUSED');
    expect(store.mails).toHaveLength(0);
  });

  it('keeps the second factor of staff, whatever they send', async () => {
    store.role = 'owner';
    const secret = authenticator(ANA);
    const answer = await disable(codeNow(secret));
    expect(answer.statusCode).toBe(403);
    expect(answer.json().detail).toBe('STAFF_TOTP_MANDATORY_REJECT');
    expect(store.totp.get(ANA)?.enabled).toBe(1);
  });
});

describe('new backup codes (FC 079 T0.4)', () => {
  const regenerate = (payload: unknown) =>
    post('/v1/account/2fa/backup-codes/regenerate', payload);

  it('replaces the old ones, once shown and never stored in clear', async () => {
    authenticator(ANA);
    store.codes = [{ user_id: ANA, hash: 'old', used: false }];
    const { backupCodes } = (await regenerate({ password: CURRENT })).json();
    expect(backupCodes).toHaveLength(8);
    expect(store.codes).toHaveLength(8);
    expect(JSON.stringify(store.codes)).not.toContain(backupCodes[0]);
    expect(store.mails).toEqual(['TOTP_BACKUP_CODES_REGENERATED']);
    expect(store.audit).toContain('BACKUP_CODES_REGENERATED');
    expect(store.keys.size).toBe(0);
  });

  it('refuses a wrong password, an account without the second factor and a bare request', async () => {
    expect((await regenerate({ password: CURRENT })).json().detail).toBe(
      'TOTP_NOT_ENABLED'
    );
    expect((await regenerate({ password: 'otra' })).json().detail).toBe(
      'INVALID_CURRENT_PASSWORD'
    );
    expect((await regenerate({})).json().detail).toBe('INVALID_REQUEST');
    expect(store.audit).toContain('BACKUP_CODES_REFUSED');
  });
});

describe('the recovery by the owner (FC 079 T1.5, T2.7)', () => {
  const REASON = 'Cotejo de dos pedidos y llamada telefónica';
  let owner: Buffer;

  beforeEach(() => {
    store.role = 'owner';
    owner = authenticator(ANA);
    authenticator(LUIS);
    store.codes = [{ user_id: LUIS, hash: 'old', used: false }];
  });

  const recover = (over: Record<string, string> = {}, key = 'r-1') =>
    post(
      '/v1/admin/users/recover-2fa',
      {
        targetEmail: ' Luis@Example.test ',
        reason: REASON,
        ownerTotpCode: codeNow(owner),
        ...over,
      },
      key
    );

  const untouched = () => {
    expect(store.totp.get(LUIS)?.enabled).toBe(1);
    expect(store.sessions).toHaveLength(3);
    expect(store.mails).toHaveLength(0);
  };

  it('turns the second factor of a customer off, closes their access, warns and audits', async () => {
    const done = await recover();
    expect(done.json()).toEqual({ success: true });
    expect(store.totp.get(LUIS)).toEqual({ encrypted: null, enabled: 0 });
    expect(store.codes).toHaveLength(0);
    expect(store.sessions.map((s) => s.id)).toEqual([MINE, OTHER_OF_ANA]);
    expect(store.devices.map((d) => d.id)).toEqual([1]);
    expect(store.totp.get(ANA)?.enabled).toBe(1);
    expect(store.mails).toEqual(['TOTP_RECOVERED']);
    expect(store.audit).toContain('CUSTOMER_2FA_RESET_BY_OWNER');
    expect(JSON.stringify([...store.keys.values()])).not.toContain(
      codeNow(owner)
    );
    const again = await recover();
    expect(again.headers['idempotency-status']).toBe('IDEMP_REPLAY_SUCCESS');
    expect(store.mails).toHaveLength(1);
  });

  it.each([
    ['a wrong code of the owner', { ownerTotpCode: 'x' }],
    ['a short reason', { reason: 'porque sí' }],
    ['an e-mail in the reason', { reason: 'Pidió luis@example.test' }],
    ['a phone in the reason', { reason: 'Llamé al 4921234567' }],
  ])('refuses %s', async (_case, over) => {
    const answer = await recover(over);
    expect(answer.statusCode).toBe(400);
    expect(answer.json().detail).toBe('INVALID_OWNER_STEPUP_OR_REASON');
    untouched();
  });

  it('refuses an owner without an authenticator', async () => {
    store.totp.delete(ANA);
    // Without it the guard stops a privileged account before the route.
    expect((await recover()).statusCode).toBe(403);
    untouched();
  });

  it('names a missing account before anything about it', async () => {
    const answer = await recover({ targetEmail: 'nadie@example.test' });
    expect(answer.statusCode).toBe(404);
    expect(answer.json().detail).toBe('USER_NOT_FOUND');
    untouched();
  });

  it('never recovers staff', async () => {
    targetRole = 'admin';
    expect((await recover()).json().detail).toBe(
      'STAFF_2FA_CANNOT_BE_RECOVERED'
    );
    untouched();
  });

  it('says when there is nothing to turn off', async () => {
    store.totp.delete(LUIS);
    expect((await recover()).json().detail).toBe('TOTP_NOT_ENABLED');
    expect(store.sessions).toHaveLength(3);
  });

  it('needs the key, the three fields and the owner’s permission', async () => {
    const noKey = await post('/v1/admin/users/recover-2fa', {});
    expect(noKey.json().detail).toBe('IDEMP_KEY_MISSING');
    const noBody = await post('/v1/admin/users/recover-2fa', {}, 'r-2');
    expect(noBody.json().detail).toBe('INVALID_REQUEST');
    store.role = 'customer';
    expect((await recover()).statusCode).toBe(403);
    untouched();
  });
});
