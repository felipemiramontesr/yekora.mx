/**
 * OWASP A09 evidence (FC 010): every security rejection leaves a structured JSON trail (request
 * id, method, path, client IP, status), server failures are logged at error level while the
 * client gets no detail, and no credential ever reaches the log.
 *
 * CORS is not in this list on purpose: a foreign origin is not rejected by the server, the
 * browser drops the answer for lack of `access-control-allow-origin` (covered by the A01
 * inventory test), so there is no server-side rejection to log.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import type { Db } from './db';

// Random per run: the test proves the value never shows up, whatever it is.
const DB_PASSWORD = randomUUID();
const config = loadConfig({
  DB_HOST: '127.0.0.1',
  DB_USER: 'root',
  DB_NAME: 'yekora_dev',
  DB_PASSWORD,
});

/** One parsed pino line. */
interface LogLine {
  level: number;
  reqId?: string;
  msg?: string;
  req?: { method: string; url: string; remoteAddress: string };
  res?: { statusCode: number };
  err?: { message: string };
}

const PINO_INFO = 30;
const PINO_ERROR = 50;

let app: FastifyInstance;
let output: string[] = [];

/** Builds the API with the production logger and captures everything it writes. */
async function loggedApp(db: Db): Promise<FastifyInstance> {
  output = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    output.push(String(chunk));
    return true;
  });
  app = await buildApp({ config, db, rate: async () => null, logger: true });
  return app;
}

/** Every JSON line written so far. */
function lines(): LogLine[] {
  return output
    .join('')
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as LogLine);
}

/** The completion line of the request to `url`, matched through its request id. */
function completed(url: string): LogLine | undefined {
  const all = lines();
  const incoming = all.find((line) => line.req?.url === url);
  return all.find(
    (line) => line.reqId === incoming?.reqId && line.msg === 'request completed'
  );
}

const emptyDb: Db = {
  query: async <Row>() => [] as Row[],
  ping: async () => undefined,
  close: async () => undefined,
};

// Pay Fastify's cold start once with its own budget (as app.test.ts does), so the first case
// keeps its 5 s even on a loaded machine or CI runner.
beforeAll(async () => {
  const warm = await buildApp({
    config,
    db: emptyDb,
    rate: async () => null,
    logger: false,
  });
  await warm.inject('/health');
  await warm.close();
}, 30_000);

afterEach(async () => {
  await app.close();
  vi.restoreAllMocks();
});

describe('A09 security rejections leave a structured trail', () => {
  it('records an invalid cart (400) with request id, method, path, IP and status', async () => {
    await (
      await loggedApp(emptyDb)
    ).inject({
      method: 'POST',
      url: '/v1/cart/quote?lang=es-MX',
      payload: { items: 'not-a-list' },
    });
    const incoming = lines().find(
      (line) => line.req?.url === '/v1/cart/quote?lang=es-MX'
    );
    expect(incoming?.req).toMatchObject({
      method: 'POST',
      remoteAddress: '127.0.0.1',
    });
    expect(completed('/v1/cart/quote?lang=es-MX')).toMatchObject({
      level: PINO_INFO,
      res: { statusCode: 400 },
    });
  });

  it('records probing of unknown paths (404)', async () => {
    await (await loggedApp(emptyDb)).inject({ url: '/admin' });
    expect(completed('/admin')?.res?.statusCode).toBe(404);
  });

  it('records the request that hits the rate limit (429)', async () => {
    const api = await loggedApp(emptyDb);
    for (let i = 0; i < 61; i += 1) {
      await api.inject({
        method: 'POST',
        url: `/v1/cart/quote?attempt=${i}`,
        payload: { items: [] },
      });
    }
    expect(completed('/v1/cart/quote?attempt=59')?.res?.statusCode).toBe(200);
    expect(completed('/v1/cart/quote?attempt=60')?.res?.statusCode).toBe(429);
  });

  it('logs a server failure at error level and tells the client nothing about it', async () => {
    const failing: Db = {
      ...emptyDb,
      query: async () => {
        throw new Error('ER_ACCESS_DENIED_ERROR: SELECT p.sku FROM products p');
      },
    };
    const response = await (
      await loggedApp(failing)
    ).inject({
      url: '/v1/catalog',
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      type: 'about:blank',
      title: 'Internal error',
      status: 500,
    });
    expect(response.body).not.toContain('SELECT');
    const failure = lines().find((line) => line.level === PINO_ERROR);
    expect(failure?.err?.message).toContain('ER_ACCESS_DENIED_ERROR');
  });
});

describe('A09 no credential reaches the log', () => {
  it('redacts authorization and cookie and never writes the database password', async () => {
    const api = await loggedApp(emptyDb);
    await api.inject({
      url: '/v1/login',
      headers: {
        authorization: 'Bearer t0ken-s3cret',
        cookie: 'sid=c00kie-s3cret',
      },
    });
    await api.inject({
      method: 'POST',
      url: '/v1/cart/quote',
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
      payload: { items: 'x' },
    });
    const logged = output.join('');
    expect(lines().length).toBeGreaterThan(0);
    for (const secret of [
      't0ken-s3cret',
      'c00kie-s3cret',
      'dXNlcjpwYXNz',
      DB_PASSWORD,
    ]) {
      expect(logged).not.toContain(secret);
    }
  });
});
