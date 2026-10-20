/**
 * OWASP A01 evidence (FC 010): the API's surface is a closed inventory of public routes, and
 * anything outside it is a 404 problem. Also the A07 reserved-slot guard (truth table T1.2): the
 * dashboard shows A07 as RESERVED SLOT only while the `A07 surface absent` cases pass here.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import type { Db } from '../services/db';

// The whole public surface. A new route, method or prefix changes this text and fails the test,
// so nothing is exposed without updating the inventory in the same commit.
const INVENTORY = [
  '├── /health (GET, HEAD)',
  '├── /v1/catalog (GET, HEAD)',
  '│   └── /:slug (GET, HEAD)',
  '├── /v1/cart/quote (POST)',
  '├── /v1/exchange-rate (GET, HEAD)',
  '└── * (OPTIONS)',
  '',
].join('\n');

// Path segments that would mean accounts, sessions or privileged actions exist (A07 trigger).
const AUTH_SEGMENT =
  /\/(login|logout|register|auth|session|token|account|password|admin|users)\b/i;
// Fastify plugins that would bring cookies, sessions or credentials into the API.
const AUTH_PLUGINS = [
  '@fastify/cookie',
  '@fastify/session',
  '@fastify/secure-session',
  '@fastify/jwt',
  '@fastify/auth',
  '@fastify/basic-auth',
  '@fastify/bearer-auth',
  '@fastify/passport',
  '@fastify/oauth2',
];

const emptyDb: Db = {
  query: async <Row>() => [] as Row[],
  ping: async () => undefined,
  close: async () => undefined,
};

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({
    config: loadConfig({
      DB_HOST: '127.0.0.1',
      DB_USER: 'root',
      DB_NAME: 'yekora_dev',
    }),
    db: emptyDb,
    rate: async () => null,
    logger: false,
  });
  await app.ready();
}, 30_000);

afterAll(async () => {
  await app.close();
});

describe('A01 closed route inventory', () => {
  it('exposes exactly the public read routes and the cart quote', () => {
    expect(app.printRoutes({ commonPrefix: false })).toBe(INVENTORY);
  });

  it('answers 404 problem+json to unknown and privileged-looking paths', async () => {
    for (const url of [
      '/admin',
      '/v1/login',
      '/api/users',
      '/v1/orders',
      '/.env',
    ]) {
      const response = await app.inject({ url });
      expect(response.statusCode).toBe(404);
      expect(response.headers['content-type']).toContain(
        'application/problem+json'
      );
      expect(response.json()).toMatchObject({
        status: 404,
        title: 'Not found',
      });
    }
  });

  it('answers 404 problem+json to a method the route does not declare', async () => {
    const attempts = [
      { method: 'PUT', url: '/v1/catalog' },
      { method: 'DELETE', url: '/v1/catalog/tienda-expedicion' },
      { method: 'PATCH', url: '/v1/exchange-rate' },
      { method: 'POST', url: '/health' },
      { method: 'GET', url: '/v1/cart/quote' },
      { method: 'DELETE', url: '/v1/cart/quote' },
    ] as const;
    for (const attempt of attempts) {
      const response = await app.inject(attempt);
      expect(response.statusCode).toBe(404);
      expect(response.headers['content-type']).toContain(
        'application/problem+json'
      );
    }
  });

  it('grants cross-origin reads to the site only', async () => {
    const site = await app.inject({
      url: '/health',
      headers: { origin: 'https://yekora.mx' },
    });
    expect(site.headers['access-control-allow-origin']).toBe(
      'https://yekora.mx'
    );
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/v1/cart/quote',
      headers: {
        origin: 'https://evil.example',
        'access-control-request-method': 'POST',
      },
    });
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('A07 surface absent', () => {
  it('no route belongs to accounts, sessions, tokens or administration', () => {
    expect(app.printRoutes({ commonPrefix: false })).not.toMatch(AUTH_SEGMENT);
  });

  it('the API depends on no cookie, session or credential plugin', () => {
    const manifest = JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../../package.json', import.meta.url)),
        'utf8'
      )
    ) as { dependencies?: Record<string, string> };
    const installed = Object.keys(manifest.dependencies ?? {});
    expect(installed.filter((name) => AUTH_PLUGINS.includes(name))).toEqual([]);
  });
});
