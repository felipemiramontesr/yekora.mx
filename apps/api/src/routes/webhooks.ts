/**
 * `POST /v1/webhooks/stripe` and `POST /v1/webhooks/mercadopago` (FC 012 F2). The body is kept
 * as the raw bytes the processor signed (`parseAs: 'buffer'`, any content type, 64 KB): parsing
 * it first would change what the signature covers. The parser lives in its own encapsulated
 * scope, so every other route keeps parsing JSON.
 *
 * Answers: 200 with the T1.3/T1.4 code (the processor stops retrying), 401 INVALID_SIGNATURE,
 * 503 SERVICE_UNAVAILABLE (not configured, or the processor could not be asked: it retries),
 * 500 STATE_CONFLICT_ANOMALY.
 *
 * @module
 */
import type { FastifyInstance } from 'fastify';
import { problem, PROBLEM_TYPE } from '../lib/problem';
import { receiveWebhook, type WebhookDeps } from '../services/webhooks';

const ROUTES = [
  ['stripe', 'STRIPE'],
  ['mercadopago', 'MERCADO_PAGO'],
] as const;

const TITLES: Record<string, string> = {
  INVALID_SIGNATURE: 'Invalid signature',
  SERVICE_UNAVAILABLE: 'Payments unavailable',
  STATE_CONFLICT_ANOMALY: 'Order state conflict',
};

/**
 * Registers both webhook receivers.
 *
 * @param app - Fastify instance.
 * @param deps - Database, processors, configuration and clock.
 */
export async function registerWebhookRoutes(
  app: FastifyInstance,
  deps: WebhookDeps
): Promise<void> {
  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser(
      '*',
      { parseAs: 'buffer', bodyLimit: 64 * 1024 },
      (_request, body, done) => done(null, body)
    );
    for (const [path, code] of ROUTES) {
      scope.post(`/v1/webhooks/${path}`, async (request, reply) => {
        const outcome = await receiveWebhook(deps, code, {
          rawBody: (request.body as Buffer | undefined) ?? Buffer.alloc(0),
          headers: request.headers,
          query: request.query as Record<string, string | undefined>,
        });
        if (outcome.status === 200) return { code: outcome.code };
        return reply
          .code(outcome.status)
          .type(PROBLEM_TYPE)
          .send(problem(outcome.status, TITLES[outcome.code], outcome.code));
      });
    }
  });
}
