import type { FastifyReply, FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { auditTrail, recordAudit } from './audit';
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

describe('catalog diffs (FC 029 T2.4, 320_AN)', () => {
  /** Records one entry and answers the before and after JSON written. */
  async function written(entityType: string, state: unknown) {
    const params: unknown[][] = [];
    const db = {
      query: async (_sql: string, values: readonly unknown[] = []) => {
        params.push([...values]);
        return [];
      },
    };
    await recordAudit(db, {
      userId: 'u1',
      action: 'PATCH /v1/admin/catalog/brands/:id',
      entityType,
      entityId: '1',
      before: null,
      after: state,
      ip: null,
    });
    return JSON.parse(params[0][5] as string) as Record<string, unknown>;
  }

  const state = {
    name: 'Cumbre',
    nameEs: 'Mochila',
    code: 'material',
    contactEmail: 'ventas@cumbre.mx',
    phone: '5512345678',
    address: 'Calle 1',
    token: 'secret',
    note: 'escribe a ventas@cumbre.mx',
  };

  it.each(['brands', 'facet_groups', 'facet_values', 'products', 'media'])(
    'keeps the public name and code of %s, and still redacts e-mail, phone, address, secrets and any @',
    async (entityType) => {
      expect(await written(entityType, state)).toEqual({
        name: 'Cumbre',
        nameEs: 'Mochila',
        code: 'material',
        contactEmail: '[redacted]',
        phone: '[redacted]',
        address: '[redacted]',
        token: '[redacted]',
        note: '[redacted]',
      });
    }
  );

  it('keeps redacting name and code outside the catalog (T2.5b)', async () => {
    expect(await written('orders', state)).toMatchObject({
      name: '[redacted]',
      nameEs: '[redacted]',
      code: '[redacted]',
    });
  });
});
