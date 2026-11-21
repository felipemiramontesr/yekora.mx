/**
 * FC 061 F1 evidence: the shipping console answers only to `shipping:manage` behind the three
 * levels of the guard (T2.4), validates the configuration (T1.1) and the 32 rates (T1.2), writes
 * once per Idempotency-Key, and leaves an audit entry without personal data (T2.3).
 *
 * The database is an in-memory table of handlers keyed by the start of each statement, so the
 * real guard, routes and services run unchanged.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { tokenHash } from '../services/authCrypto';
import type { Db, Transactional } from '../services/db';

const KEY = Buffer.alloc(32, 7);
const NOW = new Date('2026-11-21T18:00:00Z');

const OWNER = 'a0000000-0000-4000-8000-000000000001';
const NO_TOTP = 'a0000000-0000-4000-8000-000000000002';
const STAFF = 'a0000000-0000-4000-8000-000000000003';

/** Session cookies: `w` the owner, `n` an admin without authenticator, `s` a staff member. */
const TOKENS = new Map([
  [tokenHash('w'.repeat(43)), OWNER],
  [tokenHash('n'.repeat(43)), NO_TOTP],
  [tokenHash('s'.repeat(43)), STAFF],
]);
const session = (letter: string) =>
  `__Host-yekora_session=${letter.repeat(43)}`;

const ROLE_OF: Record<string, string> = {
  [OWNER]: 'owner',
  [NO_TOTP]: 'admin',
  [STAFF]: 'staff_orders',
};
const PERMISSIONS: Record<string, string[]> = {
  owner: ['account:self', 'shipping:manage'],
  admin: ['account:self', 'shipping:manage'],
  staff_orders: ['account:self', 'orders:read'],
};

interface Config {
  active_strategy_id: number;
  is_free_shipping_active: number;
  free_shipping_threshold_mxn_cents: number | null;
}

interface Rule {
  strategy_id: number;
  zone_id: number;
  rate_mxn_cents: number;
}

/** The tables the fake database holds. */
const store = {
  config: null as Config | null,
  rules: [] as Rule[],
  /** Zone ids that are active; the seed has the 32. */
  zones: [] as number[],
  audit: [] as unknown[][],
  keys: new Map<string, Record<string, unknown>>(),
};

const seededZones = () => Array.from({ length: 32 }, (_, index) => index + 1);

const seededRules = (): Rule[] =>
  seededZones().map((zone) => ({
    strategy_id: 2,
    zone_id: zone,
    rate_mxn_cents: 15000,
  }));

type Handler = (params: readonly unknown[]) => unknown[];

const named = (id: number) => ({
  id,
  name_es: `es ${id}`,
  name_en: `en ${id}`,
});

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
    'SELECT active_strategy_id, is_free_shipping_active',
    () => (store.config ? [store.config] : []),
  ],
  [
    'SELECT id, code, name_es, name_en FROM shipping_strategies',
    () =>
      [1, 2, 3, 4, 5].map((id) => ({ ...named(id), code: `STRATEGY_${id}` })),
  ],
  [
    'SELECT id, slug, name_es, name_en FROM shipping_classes',
    () => [1, 2].map((id) => ({ ...named(id), slug: `class-${id}` })),
  ],
  [
    'SELECT id, code, name_es, name_en FROM shipping_zones',
    () => store.zones.map((id) => ({ ...named(id), code: `Z${id}` })),
  ],
  ['SELECT id FROM shipping_zones', () => store.zones.map((id) => ({ id }))],
  [
    'SELECT zone_id, MIN(rate_mxn_cents)',
    (p) =>
      store.rules
        .filter((rule) => rule.strategy_id === p[0])
        .sort((a, b) => a.zone_id - b.zone_id)
        .map(({ zone_id, rate_mxn_cents }) => ({ zone_id, rate_mxn_cents })),
  ],
  [
    'SELECT r.id FROM shipping_strategies s',
    (p) =>
      store.rules
        .filter((rule) => rule.strategy_id === p[0])
        .slice(0, 1)
        .map((rule) => ({ id: rule.zone_id })),
  ],
  [
    'INSERT INTO shipping_configs',
    (p) => {
      store.config = {
        active_strategy_id: p[0] as number,
        is_free_shipping_active: p[1] as number,
        free_shipping_threshold_mxn_cents: p[2] as number | null,
      };
      return [];
    },
  ],
  [
    'DELETE FROM shipping_rules',
    (p) => {
      store.rules = store.rules.filter((rule) => rule.strategy_id !== p[0]);
      return [];
    },
  ],
  [
    'INSERT INTO shipping_rules',
    (p) => {
      store.rules.push({
        strategy_id: p[0] as number,
        zone_id: p[1] as number,
        rate_mxn_cents: p[2] as number,
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
  store.config = {
    active_strategy_id: 2,
    is_free_shipping_active: 0,
    free_shipping_threshold_mxn_cents: null,
  };
  store.rules = seededRules();
  store.zones = seededZones();
  store.audit = [];
  store.keys.clear();
});

const read = (who: string | null) =>
  app.inject({
    method: 'GET',
    url: '/v1/admin/shipping',
    headers: who === null ? {} : { cookie: session(who) },
  });

/** A write as the owner (or another session), with a key unless told otherwise. */
const write = (
  path: 'config' | 'rules',
  payload: unknown,
  options: { who?: string; key?: string | null } = {}
) =>
  app.inject({
    method: 'PUT',
    url: `/v1/admin/shipping/${path}`,
    headers: {
      cookie: session(options.who ?? 'w'),
      'content-type': 'application/json',
      ...(options.key === null
        ? {}
        : { 'idempotency-key': options.key ?? 'k-1' }),
    },
    payload: JSON.stringify(payload),
  });

const CONFIG = {
  strategyId: 2,
  isFreeShippingActive: true,
  freeShippingThresholdMxnCents: 150000,
};

const rulesBody = (rate: number) => ({
  rules: seededZones().map((zoneId) => ({ zoneId, rateMxnCents: rate })),
});

describe('the guard of /v1/admin/shipping (FC 061 T2.4)', () => {
  it('SESSION_INVALID_OR_EXPIRED · no session is a 401 before anything else', async () => {
    const response = await read(null);
    expect(response.statusCode).toBe(401);
    expect(response.json().detail).toBe('SESSION_INVALID_OR_EXPIRED');
  });

  it('SECOND_FACTOR_REQUIRED · a privileged session without the authenticator is a 403', async () => {
    const response = await read('n');
    expect(response.statusCode).toBe(403);
    expect(response.json().detail).toBe('SECOND_FACTOR_REQUIRED');
  });

  it('PERMISSION_DENIED · a verified session without shipping:manage is a 403 on every route', async () => {
    expect((await read('s')).json().detail).toBe('PERMISSION_DENIED');
    const config = await write('config', CONFIG, { who: 's' });
    expect(config.statusCode).toBe(403);
    expect(config.json().detail).toBe('PERMISSION_DENIED');
    const rules = await write('rules', rulesBody(100), { who: 's' });
    expect(rules.statusCode).toBe(403);
    expect(store.rules).toEqual(seededRules());
  });
});

describe('GET /v1/admin/shipping (FC 061 T0.2)', () => {
  it('reads the configuration, the catalogs and the rate of each of the 32 states', async () => {
    const response = await read('w');
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.config).toEqual({
      strategyId: 2,
      isFreeShippingActive: false,
      freeShippingThresholdMxnCents: null,
    });
    expect(body.strategies).toHaveLength(5);
    expect(
      body.strategies.filter((s: { administrable: boolean }) => s.administrable)
    ).toEqual([
      {
        id: 2,
        code: 'STRATEGY_2',
        nameEs: 'es 2',
        nameEn: 'en 2',
        administrable: true,
      },
    ]);
    expect(body.classes).toHaveLength(2);
    expect(body.zones).toHaveLength(32);
    expect(body.rules).toHaveLength(32);
    expect(body.rules[0]).toEqual({ zoneId: 1, rateMxnCents: 15000 });
  });

  it('shows the default configuration when the table has no row yet', async () => {
    store.config = null;
    const body = (await read('w')).json();
    expect(body.config).toEqual({
      strategyId: 2,
      isFreeShippingActive: false,
      freeShippingThresholdMxnCents: null,
    });
  });
});

describe('PUT /v1/admin/shipping/config (FC 061 T1.1, T2.3)', () => {
  it('CONFIG_MUTATION_APPLIED_200 · saves free shipping and audits before and after', async () => {
    const response = await write('config', CONFIG);
    expect(response.statusCode).toBe(200);
    expect(response.json().config).toEqual(CONFIG);
    expect(store.config).toEqual({
      active_strategy_id: 2,
      is_free_shipping_active: 1,
      free_shipping_threshold_mxn_cents: 150000,
    });
    const [entry] = written('SHIPPING_CONFIG_UPDATED');
    expect(entry.slice(0, 5)).toEqual([
      OWNER,
      'SHIPPING_CONFIG_UPDATED',
      'shipping_configs',
      '1',
      JSON.stringify({
        strategyId: 2,
        isFreeShippingActive: false,
        freeShippingThresholdMxnCents: null,
      }),
    ]);
    expect(JSON.parse(entry[5] as string)).toEqual(CONFIG);
  });

  it('turns free shipping off with a null threshold', async () => {
    await write('config', CONFIG, { key: 'k-on' });
    const response = await write(
      'config',
      {
        ...CONFIG,
        isFreeShippingActive: false,
        freeShippingThresholdMxnCents: null,
      },
      { key: 'k-off' }
    );
    expect(response.statusCode).toBe(200);
    expect(store.config?.is_free_shipping_active).toBe(0);
  });

  it('runs once per key: a replay answers the same and writes one entry', async () => {
    const first = await write('config', CONFIG);
    const replay = await write('config', CONFIG);
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotency-status']).toBe('IDEMP_REPLAY_SUCCESS');
    expect(replay.body).toBe(first.body);
    expect(written('SHIPPING_CONFIG_UPDATED')).toHaveLength(1);
  });

  it('refuses a reused key for another payload with 409', async () => {
    await write('config', CONFIG);
    const response = await write('config', {
      ...CONFIG,
      freeShippingThresholdMxnCents: 99,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().detail).toBe('IDEMP_PAYLOAD_MISMATCH');
  });

  it('CONFIG_MUTATION_REJECTED_400 · refuses a missing key and every incoherent body', async () => {
    const noKey = await write('config', CONFIG, { key: null });
    expect(noKey.statusCode).toBe(400);
    expect(noKey.json().detail).not.toBe('INVALID_REQUEST');
    const bodies = [
      { ...CONFIG, strategyId: 6 },
      { ...CONFIG, strategyId: 0 },
      { ...CONFIG, freeShippingThresholdMxnCents: null },
      { ...CONFIG, freeShippingThresholdMxnCents: 0 },
      { ...CONFIG, isFreeShippingActive: false },
      { ...CONFIG, freeShippingThresholdMxnCents: -5 },
      { ...CONFIG, extra: true },
    ];
    for (const [index, body] of bodies.entries()) {
      const response = await write('config', body, { key: `k-bad-${index}` });
      expect(response.statusCode).toBe(400);
      expect(response.json().detail).toBe('INVALID_REQUEST');
    }
    expect(written('SHIPPING_CONFIG_UPDATED')).toHaveLength(0);
  });

  it('SHIPPING_STRATEGY_UNAVAILABLE · refuses a strategy with no active rates', async () => {
    const response = await write('config', { ...CONFIG, strategyId: 4 });
    expect(response.statusCode).toBe(409);
    expect(response.json().detail).toBe('SHIPPING_STRATEGY_UNAVAILABLE');
    expect(store.config?.active_strategy_id).toBe(2);
  });
});

describe('PUT /v1/admin/shipping/rules (FC 061 T1.2, T2.3)', () => {
  it('RULE_MUTATION_ADMITTED_200 · replaces the 32 rates and audits the change', async () => {
    const response = await write('rules', rulesBody(9900));
    expect(response.statusCode).toBe(200);
    expect(response.json().rules).toEqual(
      seededZones().map((zoneId) => ({ zoneId, rateMxnCents: 9900 }))
    );
    expect(store.rules).toHaveLength(32);
    const [entry] = written('SHIPPING_RULES_UPDATED');
    expect(entry.slice(0, 4)).toEqual([
      OWNER,
      'SHIPPING_RULES_UPDATED',
      'shipping_rules',
      '*',
    ]);
    expect(JSON.parse(entry[5] as string)).toHaveLength(32);
  });

  it('accepts a free state (rate 0) and keeps rules of other strategies', async () => {
    store.rules.push({ strategy_id: 1, zone_id: 1, rate_mxn_cents: 500 });
    const body = rulesBody(100);
    body.rules[0].rateMxnCents = 0;
    expect((await write('rules', body)).statusCode).toBe(200);
    expect(store.rules.filter((rule) => rule.strategy_id === 1)).toHaveLength(
      1
    );
    expect(
      store.rules.find((rule) => rule.zone_id === 1 && rule.strategy_id === 2)
        ?.rate_mxn_cents
    ).toBe(0);
  });

  it('RULE_MUTATION_REJECTED_400 · refuses a missing key, a short or duplicated matrix and a bad rate', async () => {
    expect(
      (await write('rules', rulesBody(100), { key: null })).statusCode
    ).toBe(400);
    const duplicated = rulesBody(100);
    duplicated.rules[1].zoneId = 1;
    const negative = rulesBody(100);
    negative.rules[0].rateMxnCents = -1;
    const fractional = rulesBody(100);
    fractional.rules[0].rateMxnCents = 10.5;
    const huge = rulesBody(100);
    huge.rules[0].rateMxnCents = 10_000_001;
    const outside = rulesBody(100);
    outside.rules[0].zoneId = 33;
    const bodies = [
      { rules: rulesBody(100).rules.slice(1) },
      duplicated,
      negative,
      fractional,
      huge,
      outside,
      { rules: [] },
    ];
    for (const [index, body] of bodies.entries()) {
      const response = await write('rules', body, { key: `k-bad-${index}` });
      expect(response.statusCode).toBe(400);
      expect(response.json().detail).toBe('INVALID_REQUEST');
    }
    expect(store.rules).toEqual(seededRules());
    expect(written('SHIPPING_RULES_UPDATED')).toHaveLength(0);
  });

  it('SHIPPING_ZONE_UNKNOWN · refuses a state that is not active and changes nothing', async () => {
    store.zones = store.zones.filter((zone) => zone !== 5);
    const response = await write('rules', rulesBody(100));
    expect(response.statusCode).toBe(400);
    expect(response.json().detail).toBe('SHIPPING_ZONE_UNKNOWN');
    expect(store.rules).toEqual(seededRules());
  });
});
