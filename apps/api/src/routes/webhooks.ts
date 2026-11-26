/**
 * `POST /v1/webhooks/stripe` and `POST /v1/webhooks/mercadopago` (FC 012 F2). The body is kept
 * as the raw bytes the processor signed (`parseAs: 'buffer'`, any content type, 64 KB): parsing
 * it first would change what the signature covers. The parser lives in its own encapsulated
 * scope, so every other route keeps parsing JSON.
 *
 * Answers: 200 with the T1.3/T1.4 code (the processor stops retrying), 401 INVALID_SIGNATURE,
 * 503 SERVICE_UNAVAILABLE (not configured, or the processor could not be asked: it retries),
 * 500 STATE_CONFLICT_ANOMALY, or REFUND_STATUS_CONFLICT_ANOMALY for a refund of an order that
 * was never paid (FC 069).
 *
 * @module
 */
import type { FastifyInstance } from 'fastify';
import { problem, PROBLEM_TYPE } from '../lib/problem';
import { noteRejectedSignature } from '../services/paymentAlerts';
import { receiveWebhook, type WebhookDeps } from '../services/webhooks';

const ROUTES = [
  ['stripe', 'STRIPE'],
  ['mercadopago', 'MERCADO_PAGO'],
] as const;

const TITLES: Record<string, string> = {
  INVALID_SIGNATURE: 'Invalid signature',
  SERVICE_UNAVAILABLE: 'Payments unavailable',
  STATE_CONFLICT_ANOMALY: 'Order state conflict',
  REFUND_STATUS_CONFLICT_ANOMALY: 'Refund state conflict',
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
  // Callback-style plugin: registration is synchronous, so it signals the end with `done`.
  await app.register((scope, _options, done) => {
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
        if (outcome.status === 200) {
          // FC 066: a settled payment queued its confirmation; wake the dispatcher after the answer.
          request.outboxQueued = true;
          return { code: outcome.code };
        }
        // FC 075 T2.4: a bad signature is recorded, and a burst of them is told to the owner.
        // Recording it must never change the answer: a failure is only logged.
        if (outcome.code === 'INVALID_SIGNATURE') {
          const alerted = await noteRejectedSignature(
            deps.db,
            { processor: code, ip: request.ip },
            deps.now()
          ).catch((error: unknown) => {
            request.log.error({ error }, 'rejected signature not recorded');
            return false;
          });
          if (alerted) request.outboxQueued = true;
        }
        return reply
          .code(outcome.status)
          .type(PROBLEM_TYPE)
          .send(problem(outcome.status, TITLES[outcome.code], outcome.code));
      });
    }
    done();
  });
}
