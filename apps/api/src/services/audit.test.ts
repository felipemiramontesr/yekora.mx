import type { FastifyReply, FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { auditTrail } from './audit';
import type { Db } from './db';

/** A request as the hook reads it, after the guard set its user. */
const request = (over: Record<string, unknown>) =>
  ({
    user: { userId: 'u-1' },
    routeOptions: { url: '/v1/admin/orders' },
    method: 'GET',
    params: {},
    query: {},
    ip: '203.0.113.1',
    log: { error: vi.fn() },
    ...over,
  }) as unknown as FastifyRequest;

const reply = { statusCode: 200 } as FastifyReply;

function recordingDb() {
  const rows: unknown[][] = [];
  const db = {
    query: async (_sql: string, params: readonly unknown[] = []) => {
      rows.push([...params]);
      return [];
    },
  } as unknown as Db;
  return { db, rows };
}

describe('audit trail (FC 028 T2.5)', () => {
  it('keeps nulls, numbers and nested shapes, and redacts personal keys at any depth (T2.5b)', async () => {
    const { db, rows } = recordingDb();
    await auditTrail(db).call(
      undefined as never,
      request({
        query: {
          note: null,
          limit: 5,
          filter: { customer: { full_name: 'Ana', phone: '4929421780' } },
          contacts: [{ email: 'ana@example.com' }, 'plain'],
        },
      }),
      reply
    );
    expect(JSON.parse(rows[0][5] as string)).toEqual({
      query: {
        note: null,
        limit: 5,
        filter: { customer: { full_name: '[redacted]', phone: '[redacted]' } },
        contacts: [{ email: '[redacted]' }, 'plain'],
      },
      status: 200,
    });
  });

  it('records nothing for a request without a signed-in user, or outside the panel', async () => {
    const { db, rows } = recordingDb();
    const hook = auditTrail(db);
    await hook.call(undefined as never, request({ user: null }), reply);
    await hook.call(
      undefined as never,
      request({ routeOptions: { url: '/v1/account/orders' } }),
      reply
    );
    await hook.call(
      undefined as never,
      request({ routeOptions: { url: undefined } }),
      reply
    );
    expect(rows).toEqual([]);
  });
});
