/**
 * FC 079 F0 evidence: the change of password with the rows of T1.1a and T1.1b, once per key without
 * a fast hash of it, what it closes (T2.1), and the sessions and devices of one account only
 * (T1.2, T2.2, T2.4).
 *
 * The database is an in-memory table of handlers keyed by the start of each statement, so the real
 * guard, routes and services run unchanged.
 */
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { tokenHash } from '../services/authCrypto';
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
};
let breached = false;

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
    () => [{ role_id: 'customer', permission_id: 'account:self' }],
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
