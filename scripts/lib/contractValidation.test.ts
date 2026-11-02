import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp } from '../../apps/api/src/app';
import { loadConfig } from '../../apps/api/src/config';
import { ROUTE_CONTRACTS } from '../../apps/api/src/contract';
import { problemSchema } from '../../apps/api/src/lib/problem';
import type { Db, Transactional } from '../../apps/api/src/services/db';
import {
  breakingChanges,
  buildOpenApi,
  type ContractEntry,
  type OpenApiDocument,
  schemaChanges,
} from './contractValidation';

const INFO = { title: 'YĒKORA API', version: '1' };
const problem = z.object({ title: z.string() });

/** A one-route contract whose parts each test changes. */
function route(overrides: Partial<ContractEntry> = {}): ContractEntry {
  return {
    method: 'GET',
    path: '/v1/things/:id',
    summary: 'A thing',
    permission: 'public',
    request: {
      params: z.object({ id: z.string().regex(/^\d+$/) }),
      query: z.object({
        page: z.coerce.number().int().min(1).max(48).optional(),
      }),
    },
    responses: {
      200: z.object({ id: z.string(), color: z.enum(['red', 'blue']) }),
      404: problem,
    },
    ...overrides,
  };
}

const doc = (...routes: ContractEntry[]): OpenApiDocument =>
  buildOpenApi(routes, problem, INFO);

/**
 * `METHOD path` of every route Fastify serves, without the HEAD and OPTIONS it adds itself.
 * `printRoutes` nests a route under the one whose path it extends, four columns deeper, so the
 * full path is the parent's plus the segment on the line.
 */
function servedRoutes(tree: string): string[] {
  const routes: string[] = [];
  const parents: string[] = [];
  for (const line of tree.split('\n')) {
    const start = line.search(/[^│├└─\s]/);
    if (start < 0) continue;
    // "segment (GET, HEAD)": the methods sit in the last parentheses, when the node has any.
    const [segment, list = ''] = line.slice(start).split(' (');
    const depth = start / 4;
    // Top-level routes already sit one level in ("└── /health"), with no parent above them.
    const path = (parents[depth - 1] ?? '') + segment;
    parents[depth] = path;
    for (const method of list.replace(')', '').split(', ')) {
      if (/^[A-Z]+$/.test(method) && method !== 'HEAD' && method !== 'OPTIONS')
        routes.push(`${method} ${path}`);
    }
  }
  return routes.sort((a, b) => a.localeCompare(b));
}

describe('route registry ↔ Fastify (ADR 0014: 1:1 in both directions)', () => {
  it('declares exactly the routes the API serves: none missing, none undeclared', async () => {
    const empty: Db & Transactional = {
      query: async () => [],
      ping: async () => undefined,
      transaction: (work) => work(empty),
      close: async () => undefined,
    };
    const app = await buildApp({
      config: loadConfig({
        DB_HOST: '127.0.0.1',
        DB_USER: 'root',
        DB_NAME: 'yekora_dev',
      }),
      db: empty,
      rate: async () => null,
      logger: false,
    });
    await app.ready();
    const served = servedRoutes(app.printRoutes({ commonPrefix: false }));
    await app.close();
    const declared = ROUTE_CONTRACTS.map(
      ({ method, path }) => `${method} ${path}`
    );
    expect(served).toEqual(declared.sort((a, b) => a.localeCompare(b)));
    // Fastify's cold start under the full parallel suite can exceed 5 s (see app.test.ts).
  }, 30_000);
});

describe('buildOpenApi (FC 027 Q03)', () => {
  const built = doc(route());
  const op = built.paths['/v1/things/{id}'].get;

  it('writes OpenAPI 3.1 paths with {param} syntax and the permission of each route', () => {
    expect(built.openapi).toBe('3.1.0');
    expect(built.info).toEqual(INFO);
    expect(op['x-permission']).toBe('public');
    expect(op.summary).toBe('A thing');
  });

  it('turns params, query and headers into parameters; path params are always required', () => {
    expect(op.parameters.map((p) => [p.in, p.name, p.required])).toEqual([
      ['path', 'id', true],
      ['query', 'page', false],
    ]);
    expect(op.parameters[0].schema).not.toHaveProperty('$schema');
  });

  it('marks RFC 7807 answers as application/problem+json and the rest as JSON', () => {
    expect(Object.keys(op.responses['200'].content)).toEqual([
      'application/json',
    ]);
    expect(Object.keys(op.responses['404'].content)).toEqual([
      'application/problem+json',
    ]);
    expect(op.responses['404'].description).toBe('Not Found');
  });

  it('describes a JSON body, a raw body, headers and unusual statuses', () => {
    const posted = doc(
      route({
        method: 'POST',
        path: '/v1/things',
        request: {
          headers: z.object({ authorization: z.string() }),
          body: z.strictObject({ name: z.string() }),
        },
        responses: { 418: z.object({}) },
      }),
      route({ method: 'POST', path: '/v1/hooks', request: { rawBody: true } })
    );
    const created = posted.paths['/v1/things'].post;
    expect(created.parameters).toEqual([
      expect.objectContaining({
        in: 'header',
        name: 'authorization',
        required: true,
      }),
    ]);
    expect(
      created.requestBody?.content['application/json'].schema
    ).toMatchObject({
      required: ['name'],
    });
    expect(created.responses['418'].description).toBe('Answer');
    expect(posted.paths['/v1/hooks'].post.requestBody?.content).toEqual({
      'application/json': { schema: {} },
    });
  });

  it('matches the committed apps/api/openapi.json (the CI gate checks the same)', () => {
    const committed = JSON.parse(
      readFileSync('apps/api/openapi.json', 'utf8')
    ) as OpenApiDocument;
    expect(buildOpenApi(ROUTE_CONTRACTS, problemSchema, INFO)).toEqual(
      committed
    );
  });
});

describe('breakingChanges (FC 027 T2.2)', () => {
  const before = doc(route());

  it('accepts the same contract and purely additive changes', () => {
    expect(breakingChanges(before, before)).toEqual([]);
    const additive = route({
      request: {
        params: z.object({ id: z.string().regex(/^\d+$/) }),
        query: z.object({
          page: z.coerce.number().int().min(0).max(100).optional(),
          sort: z.string().optional(),
        }),
      },
      responses: {
        200: z.object({
          id: z.string(),
          color: z.enum(['red']),
          size: z.number(),
        }),
        404: problem,
        503: problem,
      },
    });
    expect(
      breakingChanges(before, doc(additive, route({ path: '/v1/other' })))
    ).toEqual([]);
  });

  it('refuses a removed operation', () => {
    expect(breakingChanges(before, doc(route({ path: '/v1/other' })))).toEqual([
      'GET /v1/things/{id}: removed',
    ]);
  });

  it('refuses removed, newly required or narrowed request parameters', () => {
    const narrowed = route({
      request: {
        params: z.object({ id: z.string().regex(/^\d{4}$/) }),
        query: z.object({ lang: z.string() }),
      },
    });
    expect(breakingChanges(before, doc(narrowed))).toEqual([
      'GET /v1/things/{id} path id: pattern changed',
      'GET /v1/things/{id} query page: removed',
      'GET /v1/things/{id} query lang: new required parameter',
    ]);
  });

  it('refuses answer statuses, properties or guarantees a client relies on', () => {
    const loosened = route({
      responses: {
        200: z.object({
          id: z.string().optional(),
          color: z.enum(['red', 'blue', 'green']),
        }),
      },
    });
    expect(breakingChanges(before, doc(loosened))).toEqual([
      'GET /v1/things/{id} 200.color: enum adds green',
      'GET /v1/things/{id} 200.id: no longer always present',
      'GET /v1/things/{id} 404 application/problem+json: removed',
    ]);
  });

  it('refuses a removed request body', () => {
    const posting = route({
      method: 'POST',
      request: { body: z.object({ a: z.string() }) },
    });
    const bodiless = route({ method: 'POST', request: {} });
    expect(breakingChanges(doc(posting), doc(bodiless))).toEqual([
      'POST /v1/things/{id} body application/json: removed',
    ]);
  });

  it('checks a request body field by field', () => {
    const v1 = route({
      method: 'POST',
      request: { body: z.object({ a: z.string() }) },
    });
    const v2 = route({
      method: 'POST',
      request: { body: z.object({ a: z.string(), b: z.string() }) },
    });
    expect(breakingChanges(doc(v1), doc(v2))).toEqual([
      'POST /v1/things/{id} body.b: now required',
    ]);
  });
});

describe('schemaChanges (direction of compatibility)', () => {
  it('a request may widen its type but not narrow it; an answer the reverse', () => {
    const text = { type: 'string' };
    const textOrNull = { anyOf: [{ type: 'string' }, { type: 'null' }] };
    expect(schemaChanges(text, textOrNull, 'request', 'x')).toEqual([]);
    expect(schemaChanges(textOrNull, text, 'request', 'x')).toEqual([
      'x: type string|null → string',
    ]);
    expect(schemaChanges(textOrNull, text, 'response', 'x')).toEqual([]);
    expect(schemaChanges(text, textOrNull, 'response', 'x')).toEqual([
      'x: type string → string|null',
    ]);
  });

  it('treats a schema without a type as anything, and type arrays as unions', () => {
    expect(
      schemaChanges({ type: ['string', 'null'] }, {}, 'request', 'x')
    ).toEqual([]);
    expect(schemaChanges({}, { type: 'string' }, 'response', 'x')).toEqual([]);
  });

  it('a request may not drop an enum value, raise a minimum or lower a maximum', () => {
    expect(
      schemaChanges(
        { type: 'string', enum: ['a', 'b'], minLength: 1, maxItems: 9 },
        { type: 'string', enum: ['a'], minLength: 2, maxItems: 3 },
        'request',
        'x'
      )
    ).toEqual([
      'x: enum drops b',
      'x: minLength raised to 2',
      'x: maxItems lowered to 3',
    ]);
  });

  it('follows array items and nested objects', () => {
    const before = {
      type: 'array',
      items: {
        type: 'object',
        properties: { sku: { type: 'string' } },
        required: ['sku'],
      },
    };
    const after = { type: 'array', items: { type: 'object', properties: {} } };
    expect(schemaChanges(before, after, 'response', 'items')).toEqual([
      'items[].sku: removed',
    ]);
  });
});
