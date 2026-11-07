/**
 * FC 029 F2a evidence: the catalog backoffice needs `catalog:write` before anything else
 * (T1.1, CAT_FORBIDDEN), refuses every DELETE (T2.3b), takes an image only once it passes the
 * signature, size and width checks (T1.2, T2.2b), stores it once per digest (T2.2a), runs each
 * mutation once per Idempotency-Key (T1.3, T2.3a, T2.3d, T2.3e) and writes its audit entry in
 * the same transaction (T2.4).
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

const KEY = Buffer.alloc(32, 7).toString('base64');
const NOW = new Date('2026-11-07T18:00:00Z');

const EDITOR = {
  id: 'f0000000-0000-4000-8000-000000000001',
  roles: [{ role: 'staff_catalog', permission: 'catalog:write' }],
};
const ORDERS_STAFF = {
  id: 'f0000000-0000-4000-8000-000000000002',
  roles: [{ role: 'staff_orders', permission: 'orders:read' }],
};
const USERS = new Map([
  [tokenHash('e'.repeat(43)), EDITOR],
  [tokenHash('o'.repeat(43)), ORDERS_STAFF],
]);
const session = (letter: string) =>
  `__Host-yekora_session=${letter.repeat(43)}`;

/** A PNG header of the given size; `padding` grows the file. */
function png(width: number, height: number, padding = 0): Buffer {
  const bytes = Buffer.alloc(33 + padding);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

/** The tables the fake database holds. */
const tables = {
  blobs: new Map<string, unknown[]>(),
  keys: new Map<string, Record<string, unknown>>(),
  audit: [] as unknown[][],
};

type Handler = (params: readonly unknown[]) => unknown[];

const HANDLERS: [string, Handler][] = [
  [
    'SELECT s.id, s.user_id',
    (p) => {
      const user = USERS.get(p[0] as string);
      return user
        ? [
            {
              id: p[0],
              user_id: user.id,
              email: 'x@example.test',
              full_name: 'X',
            },
          ]
        : [];
    },
  ],
  [
    'SELECT ur.role_id',
    (p) =>
      [EDITOR, ORDERS_STAFF]
        .find((user) => user.id === p[0])
        ?.roles.map((r) => ({
          role_id: r.role,
          permission_id: r.permission,
        })) ?? [],
  ],
  ['SELECT is_totp_enabled', () => [{ is_totp_enabled: 1 }]],
  [
    'SELECT route, request_hash',
    (p) => {
      const row = tables.keys.get(p[0] as string);
      return row ? [row] : [];
    },
  ],
  [
    'INSERT INTO idempotency_keys',
    (p) => {
      tables.keys.set(p[0] as string, {
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
    'SELECT sha256 FROM media_blobs',
    (p) => (tables.blobs.has(p[0] as string) ? [{ sha256: p[0] }] : []),
  ],
  [
    'INSERT INTO media_blobs',
    (p) => {
      tables.blobs.set(p[0] as string, [...p]);
      return [];
    },
  ],
  [
    'INSERT INTO audit_log',
    (p) => {
      tables.audit.push([...p]);
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

/** The audit entries a mutation wrote itself (the hook's request entries have no before/after diff of media). */
const mediaAudit = () => tables.audit.filter((row) => row[2] === 'media');

beforeAll(async () => {
  app = await buildApp({
    config: loadConfig({
      DB_HOST: '127.0.0.1',
      DB_USER: 'root',
      DB_NAME: 'yekora_dev',
      AUTH_SECRET: KEY,
      TOTP_ENCRYPTION_KEY: KEY,
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
  tables.blobs.clear();
  tables.keys.clear();
  tables.audit.length = 0;
});

/** Uploads bytes as the editor (or another session), with a key unless told otherwise. */
const upload = (
  body: Buffer | string,
  options: { type?: string; key?: string | null; who?: string } = {}
) =>
  app.inject({
    method: 'POST',
    url: '/v1/admin/catalog/media',
    headers: {
      cookie: session(options.who ?? 'e'),
      'content-type': options.type ?? 'image/png',
      ...(options.key === null
        ? {}
        : { 'idempotency-key': options.key ?? 'k-1' }),
    },
    payload: body,
  });

describe('POST /v1/admin/catalog/media (FC 029 F2a)', () => {
  it('T2.2a, T2.3a, T2.4: stores an accepted image once, with its audit entry, and answers 201', async () => {
    const image = png(600, 400);
    const res = await upload(image);
    expect(res.statusCode).toBe(201);
    expect(res.headers['idempotency-status']).toBe('IDEMP_FIRST_EXECUTION');
    const body = res.json();
    expect(body).toMatchObject({
      code: 'MEDIA_ACCEPTED',
      created: true,
      mimeType: 'image/png',
      width: 600,
      height: 400,
      sizeBytes: image.length,
    });
    expect(tables.blobs.get(body.sha256)?.[5]).toEqual(image);
    expect(mediaAudit()).toHaveLength(1);
    const [userId, action, , entityId, before, after] = mediaAudit()[0];
    expect([userId, action, entityId, before]).toEqual([
      EDITOR.id,
      'POST /v1/admin/catalog/media',
      body.sha256,
      null,
    ]);
    expect(JSON.parse(after as string)).toMatchObject({ width: 600 });
  });

  it('T2.3d: replays the same request under the same key, storing nothing again', async () => {
    const image = png(300, 300);
    const first = await upload(image);
    const again = await upload(image);
    expect(again.statusCode).toBe(201);
    expect(again.headers['idempotency-status']).toBe('IDEMP_REPLAY_SUCCESS');
    expect(again.json()).toEqual(first.json());
    expect(mediaAudit()).toHaveLength(1);
  });

  it('T2.3e: refuses the same key for other bytes with 409', async () => {
    await upload(png(300, 300));
    const res = await upload(png(600, 600));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ detail: 'IDEMP_PAYLOAD_MISMATCH' });
    expect(tables.blobs.size).toBe(1);
  });

  it('T2.2a: keeps one blob when the same bytes come under a new key', async () => {
    const image = png(1200, 800);
    await upload(image, { key: 'k-1' });
    const res = await upload(image, { key: 'k-2' });
    expect(res.json()).toMatchObject({ created: false });
    expect(tables.blobs.size).toBe(1);
    expect(mediaAudit()[1][4]).not.toBeNull();
  });

  it.each([
    [undefined, 'IDEMP_KEY_MISSING'],
    ['not a key', 'IDEMP_KEY_INVALID'],
  ])(
    'T1.3: refuses key %j with 400 %s, before reading the image',
    async (key, code) => {
      const res = await upload('<svg/>', {
        type: 'image/svg+xml',
        key: key ?? null,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ detail: code });
      expect(tables.blobs.size).toBe(0);
    }
  );

  it.each([
    [
      'SVG',
      '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>',
      'image/svg+xml',
      415,
      'MEDIA_UNSAFE_TYPE',
    ],
    [
      'a PNG declared as WebP',
      png(600, 400),
      'image/webp',
      415,
      'MEDIA_UNSAFE_TYPE',
    ],
    [
      'JSON instead of bytes',
      '{"a":1}',
      'application/json',
      415,
      'MEDIA_UNSAFE_TYPE',
    ],
    [
      'a PNG over 2 MB',
      png(1200, 1200, 2_097_152),
      'image/png',
      413,
      'MEDIA_SIZE_EXCEEDED',
    ],
    [
      'a body over the read limit',
      Buffer.alloc(4 * 1024 * 1024 + 1),
      'image/png',
      413,
      'MEDIA_SIZE_EXCEEDED',
    ],
    [
      'a width outside 1200, 600, 300',
      png(800, 600),
      'image/png',
      422,
      'MEDIA_DIMENSIONS_INVALID',
    ],
  ])(
    'T1.2: refuses %s and stores nothing',
    async (_case, body, type, status, code) => {
      const res = await upload(body, { type });
      expect(res.statusCode).toBe(status);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.json()).toMatchObject({ detail: code });
      expect(tables.blobs.size).toBe(0);
      expect(tables.keys.size).toBe(0);
    }
  );

  it('answers a malformed body with the API problem, not the upload refusal', async () => {
    const res = await upload('{bad', { type: 'application/json' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).not.toHaveProperty('detail', 'MEDIA_SIZE_EXCEEDED');
  });

  it('T1.1 P: refuses staff without catalog:write with 403 CAT_FORBIDDEN', async () => {
    const res = await upload(png(600, 400), { who: 'o' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ detail: 'CAT_FORBIDDEN' });
    expect(tables.blobs.size).toBe(0);
  });

  it('refuses without a session with 401', async () => {
    const res = await upload(png(600, 400), { who: 'x' });
    expect(res.statusCode).toBe(401);
  });
});

describe('DELETE /v1/admin/catalog/* (T1.1 M, T2.3b)', () => {
  it.each([
    '/v1/admin/catalog/media',
    '/v1/admin/catalog/products/7',
    '/v1/admin/catalog/brands/1',
  ])(
    'OWASP-A01 · answers 405 CAT_DELETE_FORBIDDEN to DELETE %s',
    async (url) => {
      await settle();
      const res = await app.inject({
        method: 'DELETE',
        url,
        headers: { cookie: session('e') },
      });
      expect(res.statusCode).toBe(405);
      expect(res.headers.allow).toBe('GET, HEAD, POST, PUT, PATCH');
      expect(res.json()).toMatchObject({ detail: 'CAT_DELETE_FORBIDDEN' });
    }
  );

  it('OWASP-A01 · names the missing permission first: CAT_FORBIDDEN before the 405', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/admin/catalog/media',
      headers: { cookie: session('o') },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ detail: 'CAT_FORBIDDEN' });
  });
});
