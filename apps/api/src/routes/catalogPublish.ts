/**
 * «Publicar cambios» (FC 029 F2c, T2.5, 321_AN): `POST /v1/admin/catalog/publish` asks GitHub
 * to run deploy.yml on main, so the static store is rebuilt from the catalog in MariaDB after
 * passing every gate of the pipeline.
 *
 * Like every catalog write it needs `catalog:write` and an `Idempotency-Key`, runs at most once
 * per key and records its `audit_log` entry in the same transaction (routes/catalogMutation.ts).
 * Without the GitHub token the route is closed (503 CAT_PUBLISH_UNAVAILABLE); when GitHub does
 * not queue the run it is a 502 CAT_PUBLISH_FAILED, which is not stored, so the same key may
 * try again. A run takes 15 to 20 minutes, so a burst is cut by a tight rate limit.
 *
 * @module
 */
import type { FastifyInstance } from 'fastify';
import { problem } from '../lib/problem';
import { recordAudit } from '../services/audit';
import { checkIdempotencyKey } from '../services/idempotency';
import { dispatchDeploy } from '../services/publish';
import { type CatalogAdminDeps, refuse, runOnce } from './catalogMutation';

/**
 * Registers the publish route.
 *
 * @param app - Fastify instance.
 * @param deps - Database, clock and the GitHub token (null when not configured).
 */
export function registerCatalogPublishRoute(
  app: FastifyInstance,
  deps: CatalogAdminDeps
): void {
  app.post(
    '/v1/admin/catalog/publish',
    { config: { rateLimit: { max: 3, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const key = checkIdempotencyKey(request.headers['idempotency-key']);
      if (key.code !== 'IDEMP_KEY_ACCEPTED') {
        return refuse(reply, 400, 'Idempotency-Key required', key.code);
      }
      const token = deps.publishToken;
      if (token === null) {
        return refuse(
          reply,
          503,
          'Publishing unavailable',
          'CAT_PUBLISH_UNAVAILABLE'
        );
      }
      return runOnce(deps, request, reply, key.key, async (tx, userId) => {
        const outcome = await dispatchDeploy(token);
        if (outcome === 'CAT_PUBLISH_FAILED') {
          return {
            status: 502,
            body: problem(502, 'GitHub did not queue the publication', outcome),
          };
        }
        const published = {
          workflow: 'deploy.yml',
          ref: 'main',
          requestedAt: deps.now().toISOString(),
        };
        await recordAudit(tx, {
          userId,
          action: 'POST /v1/admin/catalog/publish',
          entityType: 'publish',
          entityId: 'deploy.yml',
          before: null,
          after: published,
          ip: request.ip,
        });
        return { status: 202, body: { code: outcome, ...published } };
      });
    }
  );
}
