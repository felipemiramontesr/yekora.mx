/**
 * FC 051 F0 evidence: the profile and the book of addresses of an account, through `/v1/account/*`.
 * Every write runs the pipeline (session, `account:self`, `Idempotency-Key`, the key of the
 * personal data, the payload, then the transaction); what is stored is sealed for its account and
 * its row; an id of another account is a 404; the answers carry no personal data.
 *
 * The database is a small in-memory model answering each statement by its text, so the real guard,
 * routes and services run unchanged.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { tokenHash } from '../services/authCrypto';
import { decryptPii } from '../services/checkoutCrypto';
import type { Db, Transactional } from '../services/db';

const KEY = Buffer.alloc(32, 7).toString('base64');
const PII_KEY = Buffer.alloc(32, 9);
const CHECKOUT = {
  CHECKOUT_PII_KEY: PII_KEY.toString('base64'),
  CUSTOMER_EMAIL_HMAC_PEPPER: 'e'.repeat(32),
  ORDER_TOKEN_PEPPER: 't'.repeat(32),
};
const ANA = 'f0000000-0000-4000-8000-000000000001';
const LUIS = 'f0000000-0000-4000-8000-000000000002';
const sessionOf = (letter: string) =>
  `__Host-yekora_session=${letter.repeat(43)}`;
const ANA_COOKIE = sessionOf('a');
const LUIS_COOKIE = sessionOf('b');
const USER_OF: Record<string, string> = { a: ANA, b: LUIS };

/* ---------- the in-memory model ---------- */

interface Address {
  id: string;
  user_id: string;
  state_code: string;
  is_complete: number;
  address_enc: Buffer;
  created_at: number;
}

const model = {
  users: new Map<
    string,
    {
      full_name: string;
      phone_enc: Buffer | null;
      default_address_id: string | null;
    }
  >(),
  addresses: [] as Address[],
  keys: new Map<string, Record<string, unknown>>(),
  audit: [] as unknown[][],
  tick: 0,
};

const forUser = (id: unknown) => model.users.get(String(id));

type Handler = (p: readonly unknown[]) => unknown[];
const HANDLERS: [string, Handler][] = [
  [
    'SELECT s.id, s.user_id',
    (p) => {
      const letter = Object.keys(USER_OF).find(
        (key) => p[0] === tokenHash(key.repeat(43))
      );
      return letter
        ? [
            {
              id: p[0],
              user_id: USER_OF[letter],
              email: `${letter}@example.test`,
              full_name: forUser(USER_OF[letter])?.full_name,
            },
          ]
        : [];
    },
  ],
  [
    'SELECT ur.role_id',
    () => [{ role_id: 'customer', permission_id: 'account:self' }],
  ],
  ['SELECT is_totp_enabled', () => []],
  [
    'SELECT route, request_hash',
    (p) => {
      const row = model.keys.get(p[0] as string);
      return row ? [row] : [];
    },
  ],
  [
    'INSERT INTO idempotency_keys',
    (p) => {
      model.keys.set(p[0] as string, {
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
    'INSERT INTO audit_log',
    (p) => {
      model.audit.push([...p]);
      return [];
    },
  ],
  [
    'UPDATE users SET full_name = ?, phone_enc = ?',
    (p) => {
      Object.assign(forUser(p[2]) ?? {}, { full_name: p[0], phone_enc: p[1] });
      return [];
    },
  ],
  ['SELECT id FROM users WHERE id = ? FOR UPDATE', (p) => [{ id: p[0] }]],
  [
    'SELECT COUNT(*) AS placed',
    (p) => [
      { placed: model.addresses.filter((a) => a.user_id === p[0]).length },
    ],
  ],
  [
    'INSERT INTO user_addresses',
    (p) => {
      model.addresses.push({
        id: p[0] as string,
        user_id: p[1] as string,
        state_code: p[2] as string,
        is_complete: p[3] as number,
        address_enc: p[4] as Buffer,
        created_at: ++model.tick,
      });
      return [];
    },
  ],
  [
    'UPDATE users SET default_address_id = ?',
    (p) => {
      Object.assign(forUser(p[1]) ?? {}, { default_address_id: p[0] });
      return [];
    },
  ],
  [
    'SELECT id FROM user_addresses WHERE id = ? AND user_id = ? FOR UPDATE',
    (p) =>
      model.addresses
        .filter((a) => a.id === p[0] && a.user_id === p[1])
        .map((a) => ({ id: a.id })),
  ],
  [
    'UPDATE user_addresses SET state_code',
    (p) => {
      const row = model.addresses.find(
        (a) => a.id === p[2] && a.user_id === p[3]
      );
      Object.assign(row ?? {}, {
        state_code: p[0],
        address_enc: p[1],
        is_complete: 1,
      });
      return [];
    },
  ],
  [
    'SELECT is_complete FROM user_addresses',
    (p) =>
      model.addresses
        .filter((a) => a.id === p[0] && a.user_id === p[1])
        .map((a) => ({ is_complete: a.is_complete })),
  ],
  [
    'SELECT default_address_id FROM users',
    (p) => [{ default_address_id: forUser(p[0])?.default_address_id ?? null }],
  ],
  [
    'DELETE FROM user_addresses',
    (p) => {
      model.addresses = model.addresses.filter(
        (a) => !(a.id === p[0] && a.user_id === p[1])
      );
      // ON DELETE SET NULL of users.default_address_id.
      const user = forUser(p[1]);
      if (user && user.default_address_id === p[0])
        user.default_address_id = null;
      return [];
    },
  ],
  [
    'SELECT id FROM user_addresses WHERE user_id = ? ORDER BY is_complete DESC',
    (p) =>
      model.addresses
        .filter((a) => a.user_id === p[0])
        .sort(
          (a, b) => b.is_complete - a.is_complete || b.created_at - a.created_at
        )
        .slice(0, 1)
        .map((a) => ({ id: a.id })),
  ],
  [
    'SELECT id, state_code, is_complete, address_enc FROM user_addresses',
    (p) =>
      model.addresses
        .filter((a) => a.user_id === p[0])
        .sort((a, b) => a.created_at - b.created_at),
  ],
  [
    'SELECT u.phone_enc, a.id AS address_id',
    (p) => {
      const user = forUser(p[0]);
      const address = model.addresses.find(
        (a) => a.id === user?.default_address_id && a.user_id === p[0]
      );
      return [
        {
          phone_enc: user?.phone_enc ?? null,
          address_id: address?.id ?? null,
          state_code: address?.state_code ?? null,
          address_enc: address?.address_enc ?? null,
        },
      ];
    },
  ],
];

const db: Db & Transactional = {
  async query<R>(text: string, params: readonly unknown[] = []) {
    const handler = HANDLERS.find(([start]) => text.startsWith(start));
    return (handler ? handler[1](params) : []) as R[];
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
  AUTH_SECRET: KEY,
  TOTP_ENCRYPTION_KEY: KEY,
};
const boot = async (extra: Record<string, string> = {}) => {
  const built = await buildApp({
    config: loadConfig({ ...BASE, ...extra }),
    db,
    rate: async () => null,
    logger: false,
    now: () => new Date('2026-11-15T18:00:00Z'),
  });
  await built.ready();
  return built;
};

let app: FastifyInstance;
beforeAll(async () => {
  app = await boot(CHECKOUT);
}, 30_000);
afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  model.users.clear();
  model.users.set(ANA, {
    full_name: 'Ana Pérez',
    phone_enc: null,
    default_address_id: null,
  });
  model.users.set(LUIS, {
    full_name: 'Luis Gómez',
    phone_enc: null,
    default_address_id: null,
  });
  model.addresses = [];
  model.keys.clear();
  model.audit.length = 0;
  model.tick = 0;
});

let counter = 0;
const send = (
  method: 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload: unknown,
  cookie = ANA_COOKIE,
  key = `k-${++counter}`
) =>
  app.inject({
    method,
    url,
    headers: { cookie, 'idempotency-key': key },
    payload: payload as Record<string, unknown>,
  });
const read = (url: string, cookie = ANA_COOKIE) =>
  app.inject({ url, headers: { cookie } });

/** A whole address of Ana, in Zacatecas (98612), with the changes the test names. */
const casa = (overrides: Record<string, unknown> = {}) => ({
  label: 'Casa',
  name: 'Ana Pérez López',
  phone: '4929421780',
  street: 'Av. Barones',
  exteriorNumber: '209',
  neighborhood: 'Las Américas',
  municipality: 'Guadalupe',
  stateCode: 'ZAC',
  postalCode: '98612',
  ...overrides,
});
const oficina = () =>
  casa({ label: 'Oficina', street: 'Calle Hidalgo', postalCode: '98000' });
const saved = async (payload: unknown, cookie = ANA_COOKIE) =>
  (await send('POST', '/v1/account/addresses', payload, cookie)).json()
    .id as string;

describe('profile (FC 051 T1.1)', () => {
  it('changes the name and the phone, sealed for the account, and answers the name only', async () => {
    const res = await send('PATCH', '/v1/account/profile', {
      fullName: ' Ana Pérez López ',
      phone: '4929421780',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ fullName: 'Ana Pérez López' });
    const user = model.users.get(ANA);
    expect(user?.full_name).toBe('Ana Pérez López');
    expect(user?.phone_enc?.includes(Buffer.from('4929421780'))).toBe(false);
    expect(
      decryptPii(PII_KEY, ANA, 'user_phone', user?.phone_enc as Buffer)
    ).toBe('4929421780');
    // The phone is not where it would be kept in the clear: the audit and the retried answer.
    expect(JSON.stringify(model.audit)).not.toContain('4929421780');
    expect(JSON.stringify([...model.keys.values()])).not.toContain(
      '4929421780'
    );
  });

  it('gives the phone back to its holder in /me, and no one else', async () => {
    await send('PATCH', '/v1/account/profile', {
      fullName: 'Ana Pérez',
      phone: '4929421780',
    });
    expect((await read('/v1/account/me')).json()).toMatchObject({
      phone: '4929421780',
    });
    expect((await read('/v1/account/me', LUIS_COOKIE)).json()).toMatchObject({
      phone: null,
    });
  });

  it.each([
    [
      'an e-mail: it is the identifier of the account and never changes',
      { fullName: 'Ana', phone: '4929421780', email: 'x@example.test' },
    ],
    ['a short phone', { fullName: 'Ana', phone: '492942' }],
    ['a name of one letter', { fullName: 'A', phone: '4929421780' }],
    ['no body fields', {}],
  ])(
    'refuses %s with 400 INVALID_REQUEST and changes nothing',
    async (_case, body) => {
      const res = await send('PATCH', '/v1/account/profile', body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ detail: 'INVALID_REQUEST' });
      expect(model.users.get(ANA)?.phone_enc).toBeNull();
    }
  );

  it('needs an Idempotency-Key, and replays the same answer for the same one', async () => {
    const body = { fullName: 'Ana Pérez', phone: '4929421780' };
    const missing = await app.inject({
      method: 'PATCH',
      url: '/v1/account/profile',
      headers: { cookie: ANA_COOKIE },
      payload: body,
    });
    expect(missing.statusCode).toBe(400);
    const first = await send(
      'PATCH',
      '/v1/account/profile',
      body,
      ANA_COOKIE,
      'same-key-1'
    );
    const again = await send(
      'PATCH',
      '/v1/account/profile',
      body,
      ANA_COOKIE,
      'same-key-1'
    );
    expect(again.headers['idempotency-status']).toBe('IDEMP_REPLAY_SUCCESS');
    expect(again.json()).toEqual(first.json());
    const other = await send(
      'PATCH',
      '/v1/account/profile',
      { ...body, phone: '4929421781' },
      ANA_COOKIE,
      'same-key-1'
    );
    expect(other.statusCode).toBe(409);
  });
});

describe('book of addresses (FC 051 T1.2, T1.3, T2.3, T2.4)', () => {
  it('adds the first address as the default, sealed for its account and its row, and answers no personal data', async () => {
    const res = await send('POST', '/v1/account/addresses', casa());
    expect(res.statusCode).toBe(201);
    const { id } = res.json();
    expect(res.json()).toEqual({ id, isDefault: true, isComplete: true });
    expect(model.users.get(ANA)?.default_address_id).toBe(id);
    const [row] = model.addresses;
    expect(row.address_enc.includes(Buffer.from('Barones'))).toBe(false);
    expect(
      JSON.parse(
        decryptPii(PII_KEY, `${ANA}|${id}`, 'user_address', row.address_enc)
      )
    ).toMatchObject({ street: 'Av. Barones', postalCode: '98612' });
    // Moved to another account or another row, the same bytes never open.
    expect(() =>
      decryptPii(PII_KEY, `${LUIS}|${id}`, 'user_address', row.address_enc)
    ).toThrow();
    expect(JSON.stringify(model.audit)).not.toContain('Barones');
    expect(JSON.stringify([...model.keys.values()])).not.toContain('Barones');
  });

  it('lists the book oldest first, opened for its holder, with the default marked and the most it may hold', async () => {
    const first = await saved(casa());
    const second = await saved(oficina());
    const list = (await read('/v1/account/addresses')).json();
    expect(list.max).toBe(5);
    expect(list.items.map((a: { id: string }) => a.id)).toEqual([
      first,
      second,
    ]);
    expect(list.items[0]).toMatchObject({
      isDefault: true,
      isComplete: true,
      label: 'Casa',
      street: 'Av. Barones',
      postalCode: '98612',
      stateCode: 'ZAC',
    });
    expect(list.items[1]).toMatchObject({ isDefault: false, label: 'Oficina' });
    expect(
      (await read('/v1/account/addresses', LUIS_COOKIE)).json().items
    ).toEqual([]);
  });

  it('makes the new address the default when asked, and with a patch of only isDefault', async () => {
    const first = await saved(casa());
    const second = await saved({ ...oficina(), isDefault: true });
    expect(model.users.get(ANA)?.default_address_id).toBe(second);
    const back = await send('PATCH', `/v1/account/addresses/${first}`, {
      isDefault: true,
    });
    expect(back.statusCode).toBe(200);
    expect(back.json()).toEqual({
      id: first,
      isDefault: true,
      isComplete: true,
    });
    expect(model.users.get(ANA)?.default_address_id).toBe(first);
  });

  it('edits a whole address and completes the one given at sign-up', async () => {
    const { encryptPii } = await import('../services/checkoutCrypto');
    const id = 'a0000000-0000-4000-8000-0000000000a1';
    model.addresses.push({
      id,
      user_id: ANA,
      state_code: 'ZAC',
      is_complete: 0,
      address_enc: encryptPii(
        PII_KEY,
        `${ANA}|${id}`,
        'user_address',
        JSON.stringify({ postalCode: '98612' })
      ),
      created_at: ++model.tick,
    });
    const incomplete = (await read('/v1/account/addresses')).json().items[0];
    expect(incomplete).toMatchObject({
      isComplete: false,
      street: null,
      name: null,
      postalCode: '98612',
    });
    const done = await send(
      'PATCH',
      `/v1/account/addresses/${id}`,
      casa({ isDefault: true })
    );
    expect(done.json()).toEqual({ id, isDefault: true, isComplete: true });
    expect((await read('/v1/account/addresses')).json().items[0]).toMatchObject(
      {
        isComplete: true,
        street: 'Av. Barones',
      }
    );
  });

  it('edits a whole address without touching which one is the default', async () => {
    const first = await saved(casa());
    const second = await saved(oficina());
    const res = await send(
      'PATCH',
      `/v1/account/addresses/${second}`,
      casa({ label: 'Oficina nueva' })
    );
    expect(res.json()).toEqual({
      id: second,
      isDefault: false,
      isComplete: true,
    });
    expect(model.users.get(ANA)?.default_address_id).toBe(first);
    expect((await read('/v1/account/addresses')).json().items[1]).toMatchObject(
      { label: 'Oficina nueva' }
    );
  });

  it('refuses the sixth address with 409 ADDRESS_LIMIT_REACHED (T2.4)', async () => {
    for (let n = 0; n < 5; n += 1) await saved(casa({ label: `Casa ${n}` }));
    const res = await send('POST', '/v1/account/addresses', casa());
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ detail: 'ADDRESS_LIMIT_REACHED' });
    expect(model.addresses).toHaveLength(5);
    // The count is the account's own: someone else's book is empty.
    expect(
      (await send('POST', '/v1/account/addresses', casa(), LUIS_COOKIE))
        .statusCode
    ).toBe(201);
  });

  it.each([
    ['a state that is not the one of the postal code', { stateCode: 'JAL' }],
    ['a postal code that is not in Mexico', { postalCode: '17000' }],
    ['a postal code of four digits', { postalCode: '9861' }],
    ['no street', { street: '' }],
    ['a phone of nine digits', { phone: '492942178' }],
    ['an unknown field', { color: 'rojo' }],
  ])(
    'refuses %s with 400 INVALID_ADDRESS (T1.2 V)',
    async (_case, overrides) => {
      const res = await send('POST', '/v1/account/addresses', casa(overrides));
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ detail: 'INVALID_ADDRESS' });
      expect(model.addresses).toHaveLength(0);
    }
  );

  it('deletes an address, and the newest left (a complete one first) takes the default', async () => {
    const first = await saved(casa());
    const second = await saved(oficina());
    const third = await saved(casa({ label: 'Papás', postalCode: '98000' }));
    expect(model.users.get(ANA)?.default_address_id).toBe(first);
    const res = await send(
      'DELETE',
      `/v1/account/addresses/${first}`,
      undefined
    );
    expect(res.statusCode).toBe(204);
    expect(model.users.get(ANA)?.default_address_id).toBe(third);
    // A non-default one goes without moving the default.
    await send('DELETE', `/v1/account/addresses/${second}`, undefined);
    expect(model.users.get(ANA)?.default_address_id).toBe(third);
    await send('DELETE', `/v1/account/addresses/${third}`, undefined);
    expect(model.users.get(ANA)?.default_address_id).toBeNull();
    expect(model.addresses).toHaveLength(0);
  });

  it('answers 404 ADDRESS_NOT_FOUND for an id that is another account’s or does not exist, never revealing which (T2.3)', async () => {
    const mine = await saved(casa());
    const strangers = [
      ['PATCH', casa()],
      ['PATCH', { isDefault: true }],
      ['DELETE', undefined],
    ] as const;
    for (const [method, body] of strangers) {
      const theirs = await send(
        method,
        `/v1/account/addresses/${mine}`,
        body,
        LUIS_COOKIE
      );
      const nobody = await send(
        method,
        '/v1/account/addresses/a0000000-0000-4000-8000-0000000000ff',
        body,
        LUIS_COOKIE
      );
      expect([theirs.statusCode, nobody.statusCode]).toEqual([404, 404]);
      expect(theirs.json()).toMatchObject({ detail: 'ADDRESS_NOT_FOUND' });
      expect(theirs.json().detail).toBe(nobody.json().detail);
    }
    // Nothing of Ana's moved.
    expect(model.addresses).toHaveLength(1);
    expect(model.users.get(ANA)?.default_address_id).toBe(mine);
  });

  it('refuses an id that is not a UUID with 400', async () => {
    for (const method of ['PATCH', 'DELETE'] as const) {
      const res = await send(
        method,
        '/v1/account/addresses/nine',
        method === 'PATCH' ? { isDefault: true } : undefined
      );
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ detail: 'INVALID_ADDRESS' });
    }
  });

  it('runs a write once per Idempotency-Key and rejects the same key for another body', async () => {
    const first = await send(
      'POST',
      '/v1/account/addresses',
      casa(),
      ANA_COOKIE,
      'one-address'
    );
    const again = await send(
      'POST',
      '/v1/account/addresses',
      casa(),
      ANA_COOKIE,
      'one-address'
    );
    expect(again.headers['idempotency-status']).toBe('IDEMP_REPLAY_SUCCESS');
    expect(again.json()).toEqual(first.json());
    expect(model.addresses).toHaveLength(1);
    const other = await send(
      'POST',
      '/v1/account/addresses',
      oficina(),
      ANA_COOKIE,
      'one-address'
    );
    expect(other.statusCode).toBe(409);
    expect(model.addresses).toHaveLength(1);
    const missing = await app.inject({
      method: 'POST',
      url: '/v1/account/addresses',
      headers: { cookie: ANA_COOKIE },
      payload: casa(),
    });
    expect(missing.statusCode).toBe(400);
  });

  it('gives the place of the default address in /me, and no one else’s', async () => {
    await saved(casa());
    expect((await read('/v1/account/me')).json()).toMatchObject({
      postalCode: '98612',
      stateCode: 'ZAC',
    });
    expect((await read('/v1/account/me', LUIS_COOKIE)).json()).toMatchObject({
      postalCode: null,
      stateCode: null,
    });
  });

  it('is closed to a visitor: no session, no book', async () => {
    expect(
      (await app.inject({ url: '/v1/account/addresses' })).statusCode
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: '/v1/account/addresses/a0000000-0000-4000-8000-0000000000ff',
          headers: { 'idempotency-key': 'k-visitor-1' },
        })
      ).statusCode
    ).toBe(401);
  });
});

describe('without the checkout secrets (FC 051 T1.1 P)', () => {
  it('answers 503 to every write and to the list, and keeps /me working with nothing opened', async () => {
    const bare = await boot();
    try {
      const writes = [
        [
          'PATCH',
          '/v1/account/profile',
          { fullName: 'Ana', phone: '4929421780' },
        ],
        ['POST', '/v1/account/addresses', casa()],
        [
          'PATCH',
          '/v1/account/addresses/a0000000-0000-4000-8000-0000000000a1',
          { isDefault: true },
        ],
        [
          'DELETE',
          '/v1/account/addresses/a0000000-0000-4000-8000-0000000000a1',
          undefined,
        ],
      ] as const;
      for (const [method, url, payload] of writes) {
        const res = await bare.inject({
          method,
          url,
          headers: {
            cookie: ANA_COOKIE,
            'idempotency-key': `k-bare-${++counter}`,
          },
          payload: payload as Record<string, unknown>,
        });
        expect(res.statusCode).toBe(503);
        expect(res.json()).toMatchObject({ detail: 'SERVICE_UNAVAILABLE' });
      }
      const list = await bare.inject({
        url: '/v1/account/addresses',
        headers: { cookie: ANA_COOKIE },
      });
      expect(list.statusCode).toBe(503);
      const me = await bare.inject({
        url: '/v1/account/me',
        headers: { cookie: ANA_COOKIE },
      });
      expect(me.statusCode).toBe(200);
      expect(me.json()).toMatchObject({
        phone: null,
        postalCode: null,
        stateCode: null,
      });
    } finally {
      await bare.close();
    }
  });

  it('checks the idempotency key before anything else (K first)', async () => {
    const bare = await boot();
    try {
      const res = await bare.inject({
        method: 'POST',
        url: '/v1/account/addresses',
        headers: { cookie: ANA_COOKIE },
        payload: casa(),
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await bare.close();
    }
  });
});
