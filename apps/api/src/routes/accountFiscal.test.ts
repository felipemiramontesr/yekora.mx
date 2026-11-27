/**
 * FC 077 F1 evidence: the fiscal profile behind its guard, saved once per Idempotency-Key with the
 * legal name and the postal code only as ciphertext (T2.4), read back by its holder, refused by
 * name (T1.2), and closed without the key of personal data.
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
const NOW = new Date('2026-11-27T18:00:00Z');
const ANA = 'f0000000-0000-4000-8000-000000000001';
const COOKIE = `__Host-yekora_session=${'a'.repeat(43)}`;

const store = {
  row: null as Record<string, unknown> | null,
  keys: new Map<string, Record<string, unknown>>(),
  audit: [] as unknown[],
  saves: 0,
};

const HANDLERS: [string, (params: readonly unknown[]) => unknown][] = [
  [
    'SELECT s.id, s.user_id',
    (p) =>
      p[0] === tokenHash('a'.repeat(43))
        ? [{ id: p[0], user_id: ANA, email: 'ana@example.test' }]
        : [],
  ],
  [
    'SELECT ur.role_id',
    () => [{ role_id: 'customer', permission_id: 'account:self' }],
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
    'SELECT rfc, legal_name_enc',
    (p) => (store.row && p[0] === ANA ? [store.row] : []),
  ],
  [
    'INSERT INTO customer_fiscal_profiles',
    (p) => {
      store.saves += 1;
      store.row = {
        rfc: p[1],
        legal_name_enc: p[2],
        tax_system: p[3],
        postal_code_enc: p[4],
        default_cfdi_use: p[5],
      };
      return [];
    },
  ],
  [
    'INSERT INTO audit_log',
    (p) => {
      store.audit.push(...p);
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

const BASE = {
  DB_HOST: '127.0.0.1',
  DB_USER: 'root',
  DB_NAME: 'yekora_dev',
  AUTH_SECRET: KEY.toString('base64'),
  TOTP_ENCRYPTION_KEY: KEY.toString('base64'),
};
const boot = async (extra: Record<string, string> = {}) => {
  const built = await buildApp({
    config: loadConfig({ ...BASE, ...extra }),
    db,
    rate: async () => null,
    logger: false,
    now: () => NOW,
  });
  await built.ready();
  return built;
};

let app: FastifyInstance;
let keyless: FastifyInstance;

beforeAll(async () => {
  app = await boot({
    CHECKOUT_PII_KEY: KEY.toString('base64'),
    CUSTOMER_EMAIL_HMAC_PEPPER: 'e'.repeat(32),
    ORDER_TOKEN_PEPPER: 't'.repeat(32),
  });
  keyless = await boot();
}, 30_000);

afterAll(async () => {
  await app.close();
  await keyless.close();
});

beforeEach(() => {
  store.row = null;
  store.keys.clear();
  store.audit = [];
  store.saves = 0;
});

const URL = '/v1/account/fiscal-profile';
const PROFILE = {
  rfc: 'XAXX010101000',
  legalName: 'ANA KAREN FLORES BACA',
  taxSystem: '612',
  postalCode: '98612',
  defaultCfdiUse: 'G03',
};

const read = (target = app, cookie = COOKIE) =>
  target.inject({ method: 'GET', url: URL, headers: { cookie } });
const save = (
  payload: unknown = PROFILE,
  key: string | null = 'k-1',
  target = app
) =>
  target.inject({
    method: 'PUT',
    url: URL,
    headers: {
      cookie: COOKIE,
      'content-type': 'application/json',
      ...(key === null ? {} : { 'idempotency-key': key }),
    },
    payload: JSON.stringify(payload),
  });

describe('/v1/account/fiscal-profile (FC 077 F1)', () => {
  it('needs a session', async () => {
    expect((await read(app, '')).statusCode).toBe(401);
  });

  it('answers 404 before anything is saved', async () => {
    const answer = await read();
    expect(answer.statusCode).toBe(404);
    expect(answer.json().detail).toBe('FISCAL_PROFILE_NOT_FOUND');
  });

  it('saves once per key, keeps name and postal code only as ciphertext, and gives them back to the holder', async () => {
    const first = await save();
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ saved: true });
    expect((await save()).headers['idempotency-status']).toBe(
      'IDEMP_REPLAY_SUCCESS'
    );
    expect(store.saves).toBe(1);

    const kept = JSON.stringify([
      String(store.row?.legal_name_enc),
      String(store.row?.postal_code_enc),
      [...store.keys.values()],
      store.audit,
    ]);
    expect(kept).not.toContain(PROFILE.legalName);
    expect(kept).not.toContain(PROFILE.postalCode);
    expect(store.audit).toContain('FISCAL_PROFILE_SAVED');

    const back = await read();
    expect(back.statusCode).toBe(200);
    expect(back.json()).toEqual(PROFILE);
  });

  it('refuses the same key with other data', async () => {
    await save();
    const other = await save({ ...PROFILE, taxSystem: '626' });
    expect(other.statusCode).toBe(409);
  });

  it.each([
    [{ rfc: 'NOPE' }, 'INVALID_RFC_REJECT'],
    [{ legalName: 'ACME SA DE CV' }, 'INVALID_LEGAL_NAME_REJECT'],
    [{ taxSystem: '999' }, 'INVALID_TAX_SYSTEM_REJECT'],
    [{ postalCode: 'ABCDE' }, 'INVALID_POSTAL_CODE_REJECT'],
    [{ defaultCfdiUse: 'Z99' }, 'INVALID_CFDI_USE_REJECT'],
    [{ extra: 1 }, 'INVALID_REQUEST'],
  ])('refuses %j with %s and saves nothing', async (change, code) => {
    const answer = await save({ ...PROFILE, ...change });
    expect(answer.statusCode).toBe(400);
    expect(answer.json().detail).toBe(code);
    expect(store.saves).toBe(0);
  });

  it('needs an Idempotency-Key to save', async () => {
    const answer = await save(PROFILE, null);
    expect(answer.statusCode).toBe(400);
    expect(answer.json().detail).toBe('IDEMP_KEY_MISSING');
  });

  it('neither reads nor saves without the key of personal data', async () => {
    expect((await read(keyless)).statusCode).toBe(503);
    expect((await save(PROFILE, 'k-2', keyless)).statusCode).toBe(503);
  });
});
