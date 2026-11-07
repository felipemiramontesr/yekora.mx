/**
 * FC 029 F2c evidence (T2.5): «Publicar cambios» dispatches deploy.yml on main with the
 * fine-grained token, once per Idempotency-Key, with its audit entry; it is closed without the
 * token and never stores a failed dispatch.
 */
import type { FastifyInstance } from 'fastify';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { ROUTE_CONTRACTS } from '../contract';
import { tokenHash } from '../services/authCrypto';
import type { Db, Transactional } from '../services/db';

const KEY = Buffer.alloc(32, 7).toString('base64');
const EDITOR = 'f0000000-0000-4000-8000-000000000001';
const SESSION = `__Host-yekora_session=${'e'.repeat(43)}`;
const NOW = new Date('2026-11-07T19:30:00Z');

const keys = new Map<string, Record<string, unknown>>();
const audit: unknown[][] = [];

const db: Db & Transactional = {
  async query<Row>(text: string, p: readonly unknown[] = []) {
    if (text.startsWith('SELECT s.id, s.user_id'))
      return (
        p[0] === tokenHash('e'.repeat(43))
          ? [
              {
                id: p[0],
                user_id: EDITOR,
                email: 'x@example.test',
                full_name: 'X',
              },
            ]
          : []
      ) as Row[];
    if (text.startsWith('SELECT ur.role_id'))
      return [
        { role_id: 'staff_catalog', permission_id: 'catalog:write' },
      ] as Row[];
    if (text.startsWith('SELECT is_totp_enabled'))
      return [{ is_totp_enabled: 1 }] as Row[];
    if (text.startsWith('SELECT route, request_hash')) {
      const row = keys.get(p[0] as string);
      return (row ? [row] : []) as Row[];
    }
    if (text.startsWith('INSERT INTO idempotency_keys')) {
      keys.set(p[0] as string, {
        route: p[2],
        request_hash: p[3],
        response_status: p[4],
        response_body: p[6],
        expires_at: p[7],
      });
    }
    if (text.startsWith('INSERT INTO audit_log')) audit.push([...p]);
    return [] as Row[];
  },
  ping: async () => undefined,
  transaction(work) {
    return work(this);
  },
  close: async () => undefined,
};

/** The app with or without the GitHub token. */
async function build(token?: string) {
  const app = await buildApp({
    config: loadConfig({
      DB_HOST: '127.0.0.1',
      DB_USER: 'root',
      DB_NAME: 'yekora_dev',
      AUTH_SECRET: KEY,
      TOTP_ENCRYPTION_KEY: KEY,
      ...(token && { GITHUB_PUBLISH_TOKEN: token }),
    }),
    db,
    rate: async () => null,
    logger: false,
    now: () => NOW,
  });
  await app.ready();
  return app;
}

let withToken: FastifyInstance;
let withoutToken: FastifyInstance;
const github = vi.fn<typeof fetch>();

// Pay Fastify's cold start once; each test then gets fresh apps, so the publish rate limit
// (3 per 10 minutes and address) of one test never reaches the next.
beforeAll(async () => {
  await (await build()).close();
}, 30_000);

afterEach(async () => {
  await withToken.close();
  await withoutToken.close();
});

beforeEach(async () => {
  withToken = await build('github_pat_x');
  withoutToken = await build();
  keys.clear();
  audit.length = 0;
  github.mockReset();
  github.mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', github);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const publish = (app: FastifyInstance, key: string | null = 'pub-1') =>
  app.inject({
    method: 'POST',
    url: '/v1/admin/catalog/publish',
    headers: { cookie: SESSION, ...(key ? { 'idempotency-key': key } : {}) },
  });

describe('POST /v1/admin/catalog/publish (FC 029 T2.5)', () => {
  it('dispatches deploy.yml on main and answers 202, with its audit entry', async () => {
    const res = await publish(withToken);
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({
      code: 'CAT_PUBLISH_REQUESTED',
      workflow: 'deploy.yml',
      ref: 'main',
      requestedAt: NOW.toISOString(),
    });
    const contract = ROUTE_CONTRACTS.find(
      (r) => r.path === '/v1/admin/catalog/publish'
    );
    expect(contract?.responses[202].safeParse(res.json()).success).toBe(true);
    expect(github).toHaveBeenCalledOnce();
    expect(github.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: 'Bearer github_pat_x',
    });
    expect(audit.filter((row) => row[2] === 'publish')).toHaveLength(1);
  });

  it('T2.3d: a repeated key replays the answer without a second dispatch', async () => {
    await publish(withToken);
    const again = await publish(withToken);
    expect(again.statusCode).toBe(202);
    expect(again.headers['idempotency-status']).toBe('IDEMP_REPLAY_SUCCESS');
    expect(github).toHaveBeenCalledOnce();
  });

  it('answers 502 CAT_PUBLISH_FAILED when GitHub does not queue the run, and lets the key retry', async () => {
    github.mockResolvedValueOnce(new Response('{}', { status: 403 }));
    const failed = await publish(withToken);
    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toMatchObject({ detail: 'CAT_PUBLISH_FAILED' });
    expect(keys.size).toBe(0);
    const retried = await publish(withToken);
    expect(retried.statusCode).toBe(202);
  });

  it('stays closed without the token (503) and never calls GitHub', async () => {
    const res = await publish(withoutToken);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ detail: 'CAT_PUBLISH_UNAVAILABLE' });
    expect(github).not.toHaveBeenCalled();
  });

  it('T1.3: asks for the Idempotency-Key first', async () => {
    const res = await publish(withToken, null);
    expect(res.json()).toMatchObject({ detail: 'IDEMP_KEY_MISSING' });
    expect(github).not.toHaveBeenCalled();
  });

  it('cuts a burst: a fourth publication within 10 minutes is a 429', async () => {
    for (const key of ['b-1', 'b-2', 'b-3']) {
      expect((await publish(withToken, key)).statusCode).toBe(202);
    }
    expect((await publish(withToken, 'b-4')).statusCode).toBe(429);
    expect(github).toHaveBeenCalledTimes(3);
  });
});
