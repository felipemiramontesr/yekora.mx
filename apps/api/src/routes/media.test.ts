/**
 * FC 029 F1 evidence (T2.2c): `GET /v1/media/:sha256` answers 200 only with bytes that hash to
 * the digest in the route, as an immutable year-long cache, loadable from the site (same-site)
 * and never sniffed; anything else is a problem.
 */
import { createHash } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { ROUTE_CONTRACTS } from '../contract';
import { problemSchema } from '../lib/problem';
import type { Db, Transactional } from '../services/db';

const config = loadConfig({
  DB_HOST: '127.0.0.1',
  DB_USER: 'root',
  DB_NAME: 'yekora_dev',
});

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
const digest = createHash('sha256').update(png).digest('hex');

/** Db port holding blobs by digest; a row may hold bytes that do not match its key. */
function blobs(rows: Record<string, Buffer>): Db & Transactional {
  return {
    async query<Row>(_sql: string, params: readonly unknown[] = []) {
      const data = rows[params[0] as string];
      return (
        data ? [{ mime_type: 'image/png', media_data: data }] : []
      ) as Row[];
    },
    ping: async () => undefined,
    transaction(work) {
      return work(this);
    },
    close: async () => undefined,
  };
}

let app: FastifyInstance | undefined;
async function serve(rows: Record<string, Buffer>, url: string) {
  app = await buildApp({
    config,
    db: blobs(rows),
    rate: async () => null,
    logger: false,
  });
  return app.inject(url);
}

beforeAll(async () => {
  await (
    await serve({}, '/health')
  )?.body;
}, 30_000);

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const contract = ROUTE_CONTRACTS.find((r) => r.path === '/v1/media/:sha256');

describe('GET /v1/media/:sha256 (FC 029 F1, T2.2c)', () => {
  it('serves the stored bytes, whose SHA-256 equals the route, as an immutable image', async () => {
    const res = await serve({ [digest]: png }, `/v1/media/${digest}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe(
      'public, max-age=31536000, immutable'
    );
    expect(res.headers['cross-origin-resource-policy']).toBe('same-site');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(createHash('sha256').update(res.rawPayload).digest('hex')).toBe(
      digest
    );
    expect(contract?.responses[200].safeParse(res.rawPayload).success).toBe(
      true
    );
  });

  it('never serves bytes that do not hash to the route: a 500 problem instead', async () => {
    const res = await serve(
      { [digest]: Buffer.from('tampered') },
      `/v1/media/${digest}`
    );
    expect(res.statusCode).toBe(500);
    expect(res.headers['cache-control']).toBeUndefined();
    expect(problemSchema.safeParse(res.json()).success).toBe(true);
  });

  it('answers 404 when no blob has that digest', async () => {
    const res = await serve({}, `/v1/media/${digest}`);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ status: 404, title: 'Media not found' });
  });

  it.each([digest.toUpperCase(), digest.slice(1), 'not-a-digest'])(
    'refuses %s with a 400 problem, before any query',
    async (value) => {
      const res = await serve({ [digest]: png }, `/v1/media/${value}`);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        status: 400,
        title: 'Invalid media digest',
      });
    }
  );

  it('declares the image types of migration 006 as its binary answer', () => {
    expect(contract?.binary).toEqual(['image/webp', 'image/jpeg', 'image/png']);
    expect(contract?.permission).toBe('public');
  });
});
