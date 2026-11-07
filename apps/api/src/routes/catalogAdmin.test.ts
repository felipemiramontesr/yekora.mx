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
import { ROUTE_CONTRACTS } from '../contract';

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
  brands: [] as Record<string, unknown>[],
  groups: [] as Record<string, unknown>[],
};

/** A facet group row; Nivel is the system group of migration 006. */
const groupRow = (id: number, code: string, isSystem: number) => ({
  id,
  code,
  name_es: code,
  name_en: code,
  is_required: 0,
  is_ordered: 0,
  is_filterable: 1,
  show_on_landing: 0,
  is_system: isSystem,
  is_active: 1,
  sort_order: id,
});

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
  [
    'SELECT id, slug, name, website, is_active FROM brands ORDER',
    () => tables.brands,
  ],
  [
    'INSERT INTO brands',
    (p) => {
      if (p[0] === 'boom') throw new Error('database is down');
      if (tables.brands.some((b) => b.slug === p[0]))
        throw Object.assign(new Error('Duplicate entry'), {
          code: 'ER_DUP_ENTRY',
        });
      tables.brands.push({
        id: tables.brands.length + 1,
        slug: p[0],
        name: p[1],
        website: p[2],
        is_active: 1,
      });
      return [];
    },
  ],
  [
    'SELECT id, slug, name, website, is_active FROM brands WHERE slug',
    (p) => tables.brands.filter((b) => b.slug === p[0]),
  ],
  [
    'SELECT id, slug, name, website, is_active FROM brands WHERE id',
    (p) => tables.brands.filter((b) => b.id === p[0]),
  ],
  [
    'UPDATE brands SET',
    (p) => {
      const row = tables.brands.find((b) => b.id === p[3]);
      Object.assign(row ?? {}, { name: p[0], website: p[1], is_active: p[2] });
      return [];
    },
  ],
  [
    'SELECT id, code, name_es, name_en, is_required, is_ordered, is_filterable, show_on_landing, is_system, is_active, sort_order FROM product_facet_groups WHERE id',
    (p) => tables.groups.filter((g) => g.id === p[0]),
  ],
  [
    'SELECT id, code, name_es, name_en, is_required, is_ordered, is_filterable, show_on_landing, is_system, is_active, sort_order FROM product_facet_groups ORDER',
    () => tables.groups,
  ],
  [
    'SELECT id, code, name_es, name_en, is_required, is_ordered, is_filterable, show_on_landing, is_system, is_active, sort_order FROM product_facet_groups WHERE code',
    (p) => [groupRow(3, p[0] as string, 0)],
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
  tables.brands.length = 0;
  tables.groups = [groupRow(1, 'nivel', 1), groupRow(2, 'material', 0)];
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

/** A JSON write as the editor (or another session), with a key unless told otherwise. */
const write = (
  method: 'POST' | 'PATCH',
  url: string,
  payload: unknown,
  options: { key?: string | null; who?: string } = {}
) =>
  app.inject({
    method,
    url,
    headers: {
      cookie: session(options.who ?? 'e'),
      ...(options.key === null
        ? {}
        : {
            'idempotency-key':
              options.key ??
              `k-${url}-${JSON.stringify(payload)}`
                .replaceAll(/[^A-Za-z0-9_.:-]/g, '_')
                .slice(0, 128),
          }),
    },
    payload: payload as Record<string, unknown>,
  });

const auditOf = (entity: string) =>
  tables.audit.filter((row) => row[2] === entity);

describe('brands and facets (FC 029 F2b, through the mutation pipeline)', () => {
  it('T1.1: creates a brand (201), with its audit diff in the same transaction (T2.4)', async () => {
    const res = await write('POST', '/v1/admin/catalog/brands', {
      slug: 'cumbre',
      name: 'Cumbre',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      id: 1,
      slug: 'cumbre',
      name: 'Cumbre',
      website: null,
      isActive: true,
    });
    const route = ROUTE_CONTRACTS.find(
      (r) => r.method === 'POST' && r.path === '/v1/admin/catalog/brands'
    );
    expect(route?.responses[201].safeParse(res.json()).success).toBe(true);
    const [entry] = auditOf('brands');
    expect([entry[1], entry[3], entry[4]]).toEqual([
      'POST /v1/admin/catalog/brands',
      '1',
      null,
    ]);
  });

  it('T2.3c: retires a brand with isActive false (200), keeping before and after', async () => {
    await write('POST', '/v1/admin/catalog/brands', {
      slug: 'cumbre',
      name: 'Cumbre',
    });
    const res = await write('PATCH', '/v1/admin/catalog/brands/1', {
      isActive: false,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ isActive: false });
    const entry = auditOf('brands')[1];
    expect(JSON.parse(entry[4] as string)).toMatchObject({ isActive: true });
    expect(JSON.parse(entry[5] as string)).toMatchObject({ isActive: false });
    const list = await app.inject({
      url: '/v1/admin/catalog/brands',
      headers: { cookie: session('e') },
    });
    expect(list.json()).toEqual([expect.objectContaining({ isActive: false })]);
  });

  it('answers a taken slug with 409 CAT_CONFLICT and an unknown id with 404, as problems', async () => {
    await write('POST', '/v1/admin/catalog/brands', {
      slug: 'cumbre',
      name: 'A',
    });
    const taken = await write('POST', '/v1/admin/catalog/brands', {
      slug: 'cumbre',
      name: 'B',
    });
    expect(taken.statusCode).toBe(409);
    expect(taken.headers['content-type']).toContain('application/problem+json');
    expect(taken.json()).toMatchObject({ detail: 'CAT_CONFLICT' });
    const missing = await write('PATCH', '/v1/admin/catalog/brands/42', {
      name: 'X',
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ detail: 'CAT_NOT_FOUND' });
    expect(auditOf('brands')).toHaveLength(1);
  });

  it.each([
    ['an unknown field', { slug: 'cumbre', name: 'A', logo: 'x' }],
    ['a slug with capitals', { slug: 'Cumbre', name: 'A' }],
    ['an empty name', { slug: 'cumbre', name: '  ' }],
    [
      'a plain-http website',
      { slug: 'cumbre', name: 'A', website: 'mailto:a@x.mx' },
    ],
  ])(
    'T1.1 V: refuses %s with 400 CAT_VALIDATION_ERROR',
    async (_case, payload) => {
      const res = await write('POST', '/v1/admin/catalog/brands', payload);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ detail: 'CAT_VALIDATION_ERROR' });
      expect(tables.brands).toHaveLength(0);
    }
  );

  it('refuses a non-numeric id with 400 CAT_VALIDATION_ERROR', async () => {
    const res = await write('PATCH', '/v1/admin/catalog/brands/abc', {
      name: 'X',
    });
    expect(res.json()).toMatchObject({ detail: 'CAT_VALIDATION_ERROR' });
  });

  it('T1.3: asks for the key before reading the payload', async () => {
    const res = await write(
      'POST',
      '/v1/admin/catalog/brands',
      { bad: true },
      { key: null }
    );
    expect(res.json()).toMatchObject({ detail: 'IDEMP_KEY_MISSING' });
  });

  it('T2.3d: replays a create under the same key without a second brand', async () => {
    const payload = { slug: 'cumbre', name: 'Cumbre' };
    await write('POST', '/v1/admin/catalog/brands', payload, { key: 'same' });
    const again = await write('POST', '/v1/admin/catalog/brands', payload, {
      key: 'same',
    });
    expect(again.statusCode).toBe(201);
    expect(again.headers['idempotency-status']).toBe('IDEMP_REPLAY_SUCCESS');
    expect(tables.brands).toHaveLength(1);
  });

  it('answers a database failure as a 500 problem, storing nothing', async () => {
    const res = await write('POST', '/v1/admin/catalog/brands', {
      slug: 'boom',
      name: 'X',
    });
    expect(res.statusCode).toBe(500);
    expect(tables.keys.size).toBe(0);
  });

  it('T2.1b: refuses to retire the system group Nivel with 409 CAT_SYSTEM_GROUP_LOCKED', async () => {
    const res = await write('PATCH', '/v1/admin/catalog/facet-groups/1', {
      isActive: false,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ detail: 'CAT_SYSTEM_GROUP_LOCKED' });
    expect(auditOf('facet_groups')).toHaveLength(0);
  });

  it('creates a facet group (201); adds no value to Nivel; answers an unknown value 404', async () => {
    const group = await write('POST', '/v1/admin/catalog/facet-groups', {
      code: 'peso',
      nameEs: 'Peso',
      nameEn: 'Weight',
    });
    expect(group.statusCode).toBe(201);
    expect(group.json()).toMatchObject({ code: 'peso', isSystem: false });
    const onNivel = await write(
      'POST',
      '/v1/admin/catalog/facet-groups/1/values',
      {
        code: 'leyenda',
        valueEs: 'Leyenda',
        valueEn: 'Legend',
      }
    );
    expect(onNivel.json()).toMatchObject({ detail: 'CAT_SYSTEM_GROUP_LOCKED' });
    const value = await write('PATCH', '/v1/admin/catalog/facet-values/77', {
      valueEs: 'X',
    });
    expect(value.json()).toMatchObject({ detail: 'CAT_NOT_FOUND' });
  });

  it('lists the facet groups for the console', async () => {
    const res = await app.inject({
      url: '/v1/admin/catalog/facets',
      headers: { cookie: session('e') },
    });
    expect(res.json().map((g: { code: string }) => g.code)).toEqual([
      'nivel',
      'material',
    ]);
  });

  it('T1.1 P: keeps the lists and writes to catalog:write', async () => {
    const list = await app.inject({
      url: '/v1/admin/catalog/brands',
      headers: { cookie: session('o') },
    });
    expect(list.statusCode).toBe(403);
    const created = await write(
      'POST',
      '/v1/admin/catalog/facet-groups',
      { code: 'material', nameEs: 'M', nameEn: 'M' },
      { who: 'o' }
    );
    expect(created.json()).toMatchObject({ detail: 'CAT_FORBIDDEN' });
  });
});
