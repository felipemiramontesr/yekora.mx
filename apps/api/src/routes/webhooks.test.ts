import type { FastifyInstance } from 'fastify';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import type { Db, Transactional } from '../services/db';
import type {
  PaymentProcessorPort,
  VerifiedEvent,
  WebhookInput,
} from '../services/paymentPort';

const config = loadConfig({
  DB_HOST: '127.0.0.1',
  DB_USER: 'root',
  DB_NAME: 'yekora_dev',
});

/** How many bad signatures the audit log holds; -1 means the log cannot be read. */
let rejections = -1;
/** The mail queued by an alert. */
const queued: unknown[] = [];

/** Nothing recorded yet; every write succeeds. */
const db: Db & Transactional = {
  query: async <Row>(sql: string, params: readonly unknown[] = []) => {
    if (sql.startsWith('SELECT COUNT(*) AS n FROM audit_log')) {
      const hour = String(params[0]) === 'WEBHOOK_SIGNATURE_ANOMALY';
      if (rejections < 0) return [] as Row[];
      return [{ n: hour ? 0 : rejections }] as unknown as Row[];
    }
    if (sql.startsWith('SELECT DISTINCT u.id')) {
      return [{ id: 'owner-1' }] as unknown as Row[];
    }
    if (sql.startsWith('INSERT INTO outbox_events')) queued.push(params[0]);
    return (sql.startsWith('INSERT')
      ? { affectedRows: 1 }
      : []) as unknown as Row[];
  },
  ping: async () => undefined,
  transaction(work) {
    return work(this);
  },
  close: async () => undefined,
};

/** A processor that records what it was given and verifies only the expected bytes. */
function processor(signed: string | null) {
  const received: WebhookInput[] = [];
  const port: PaymentProcessorPort = {
    createSession: vi.fn(),
    verifyWebhook(input): VerifiedEvent | null {
      received.push(input);
      return signed !== null && input.rawBody.toString('utf8') === signed
        ? { eventId: 'evt_1', type: 'other.event', resourceId: null }
        : null;
    },
    fetchPayment: vi.fn(),
    ping: async () => true,
  };
  return { port, received };
}

let app: FastifyInstance;

async function makeApp(port?: PaymentProcessorPort) {
  app = await buildApp({
    config,
    db,
    rate: async () => null,
    logger: false,
    ...(port && { processors: { STRIPE: port, MERCADO_PAGO: port } }),
  });
  return app;
}

// Same cold-start budget as app.test.ts.
beforeAll(async () => {
  await (await makeApp()).inject('/health');
  await app.close();
}, 30_000);

afterEach(async () => {
  await app.close();
});

const BODY = '{ "id" : "evt_1",\n  "type":"other.event" }';

describe('POST /v1/webhooks/stripe and /v1/webhooks/mercadopago', () => {
  it('hands the adapter the exact signed bytes, headers and query', async () => {
    const { port, received } = processor(BODY);
    await makeApp(port);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/mercadopago?data.id=123&type=payment',
      headers: {
        'content-type': 'application/json',
        'x-signature': 'ts=1,v1=x',
        'x-request-id': 'req-1',
      },
      payload: BODY,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ code: 'PAYMENT_UNCONFIRMED' });
    expect(received[0].rawBody.equals(Buffer.from(BODY))).toBe(true);
    expect(received[0].headers['x-signature']).toBe('ts=1,v1=x');
    expect(received[0].query).toEqual({ 'data.id': '123', type: 'payment' });
  });

  it('refuses a bad signature with 401 INVALID_SIGNATURE', async () => {
    await makeApp(processor(BODY).port);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      headers: { 'content-type': 'application/json' },
      payload: `${BODY} `,
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.json()).toEqual({
      type: 'about:blank',
      title: 'Invalid signature',
      status: 401,
      detail: 'INVALID_SIGNATURE',
    });
  });

  it('tells the owner about the tenth bad signature, still answering 401 (FC 075 T2.4)', async () => {
    rejections = 9;
    await makeApp(processor(BODY).port);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      headers: { 'content-type': 'application/json' },
      payload: `${BODY} `,
    });
    rejections = -1;
    expect(res.statusCode).toBe(401);
    expect(queued).toEqual(['WEBHOOK_SIGNATURE_ANOMALY']);
  });

  it('takes a delivery with no body or content type as empty bytes', async () => {
    const { port, received } = processor(null);
    await makeApp(port);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
    });
    expect(res.statusCode).toBe(401);
    expect(received[0].rawBody).toHaveLength(0);
  });

  it('accepts any content type as bytes, up to 64 KB', async () => {
    const { port, received } = processor(null);
    await makeApp(port);
    const form = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'a=1',
    });
    expect(form.statusCode).toBe(401);
    expect(received[0].rawBody.toString()).toBe('a=1');
    const big = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      headers: { 'content-type': 'application/json' },
      payload: 'x'.repeat(65 * 1024),
    });
    expect(big.statusCode).toBe(413);
  });

  it('is closed (503) while the processor has no secrets', async () => {
    await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/stripe',
      payload: BODY,
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().detail).toBe('SERVICE_UNAVAILABLE');
  });

  it('leaves JSON parsing as it was for the other routes', async () => {
    await makeApp(processor(null).port);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/checkout',
      payload: { method: 'CARD' },
    });
    // Parsed as an object: the method is read (raw bytes would be INVALID_REQUEST), then K
    // stops it because this configuration has no checkout secrets.
    expect(res.json().detail).toBe('SERVICE_UNAVAILABLE');
  });
});
