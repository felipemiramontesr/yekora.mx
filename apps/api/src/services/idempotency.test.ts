import { describe, expect, it, vi } from 'vitest';
import type { Transactional, TxQuery } from './db';
import { checkIdempotencyKey, requestHash, runIdempotent } from './idempotency';

const NOW = new Date('2026-11-07T12:00:00Z');
const ROUTE = 'POST /v1/admin/catalog/media';

/** A stored row of idempotency_keys, as the SELECT returns it. */
const stored = (overrides: Record<string, unknown> = {}) => ({
  route: ROUTE,
  request_hash: 'h1',
  response_status: 201,
  response_body: JSON.stringify({ code: 'MEDIA_ACCEPTED' }),
  expires_at: new Date('2026-11-08T00:00:00Z'),
  ...overrides,
});

/** A transactional fake whose SELECT answers `row`, recording every statement. */
function fakeDb(row?: Record<string, unknown>) {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const tx: TxQuery = {
    async query<Row>(sql: string, params: readonly unknown[] = []) {
      calls.push({ sql, params });
      return (sql.startsWith('SELECT') && row ? [row] : []) as Row[];
    },
  };
  const db: Transactional = { transaction: (work) => work(tx) };
  return { db, calls };
}

const request = {
  userId: 'u1',
  key: 'k-1',
  route: ROUTE,
  requestHash: 'h1',
  now: NOW,
};

describe('checkIdempotencyKey (T1.3 K and F)', () => {
  it('accepts up to 128 letters, digits and _ . : -', () => {
    expect(checkIdempotencyKey('3f2a-b9_c.d:e')).toEqual({
      code: 'IDEMP_KEY_ACCEPTED',
      key: '3f2a-b9_c.d:e',
    });
    expect(checkIdempotencyKey('k'.repeat(128)).code).toBe(
      'IDEMP_KEY_ACCEPTED'
    );
  });

  it('names a missing header IDEMP_KEY_MISSING', () => {
    expect(checkIdempotencyKey(undefined).code).toBe('IDEMP_KEY_MISSING');
  });

  it.each([['k'.repeat(129)], [''], ['key with spaces'], [['a', 'b']]])(
    'names %j IDEMP_KEY_INVALID',
    (header) => {
      expect(checkIdempotencyKey(header).code).toBe('IDEMP_KEY_INVALID');
    }
  );
});

describe('requestHash', () => {
  it('fingerprints bytes and JSON by their type and content', () => {
    const bytes = Buffer.from([1, 2, 3]);
    expect(requestHash('image/png', bytes)).toBe(
      requestHash('image/png', bytes)
    );
    expect(requestHash('image/png', bytes)).not.toBe(
      requestHash('image/webp', bytes)
    );
    expect(requestHash('application/json', { a: 1 })).not.toBe(
      requestHash('application/json', { a: 2 })
    );
    expect(requestHash('application/json', undefined)).toBe(
      requestHash('application/json', null)
    );
  });
});

describe('runIdempotent', () => {
  it('T2.3a: runs an unseen key and stores its answer in the same transaction', async () => {
    const { db, calls } = fakeDb();
    const work = vi.fn(async () => ({ status: 201, body: { ok: true } }));
    await expect(runIdempotent(db, request, work)).resolves.toEqual({
      code: 'IDEMP_FIRST_EXECUTION',
      answer: { status: 201, body: { ok: true } },
    });
    expect(work).toHaveBeenCalledOnce();
    const insert = calls.find((c) => c.sql.startsWith('INSERT'));
    expect(insert?.params.slice(2, 7)).toEqual([
      ROUTE,
      'h1',
      201,
      '{}',
      '{"ok":true}',
    ]);
    expect(insert?.params[7]).toEqual(new Date('2026-11-08T12:00:00Z'));
    // The key is the user's: the stored hash covers the user id, never the raw key.
    expect(insert?.params[0]).not.toBe('k-1');
    expect(insert?.params[1]).toBe('u1');
  });

  it('stores no refusal: a non-2xx answer may be retried with the same key', async () => {
    const { db, calls } = fakeDb();
    const outcome = await runIdempotent(db, request, async () => ({
      status: 422,
      body: {},
    }));
    expect(outcome.code).toBe('IDEMP_FIRST_EXECUTION');
    expect(calls.some((c) => c.sql.startsWith('INSERT'))).toBe(false);
  });

  it('T2.3d: replays a live answer of the same request without running it again', async () => {
    const { db, calls } = fakeDb(stored());
    const work = vi.fn();
    await expect(runIdempotent(db, request, work)).resolves.toEqual({
      code: 'IDEMP_REPLAY_SUCCESS',
      answer: { status: 201, body: { code: 'MEDIA_ACCEPTED' } },
    });
    expect(work).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('FOR UPDATE');
  });

  it.each([
    ['another request', { request_hash: 'h2' }],
    ['another route', { route: 'PATCH /v1/admin/catalog/products/:id' }],
  ])('T2.3e: refuses a live key reused for %s', async (_case, overrides) => {
    const { db } = fakeDb(stored(overrides));
    const work = vi.fn();
    await expect(runIdempotent(db, request, work)).resolves.toEqual({
      code: 'IDEMP_PAYLOAD_MISMATCH',
    });
    expect(work).not.toHaveBeenCalled();
  });

  it('forgets an expired key and runs the request as new', async () => {
    const { db, calls } = fakeDb(
      stored({
        request_hash: 'old',
        expires_at: new Date('2026-11-07T11:00:00Z'),
      })
    );
    const outcome = await runIdempotent(db, request, async () => ({
      status: 200,
      body: [],
    }));
    expect(outcome.code).toBe('IDEMP_FIRST_EXECUTION');
    expect(calls.map((c) => c.sql.split(' ')[0])).toEqual([
      'SELECT',
      'DELETE',
      'INSERT',
    ]);
  });
});
