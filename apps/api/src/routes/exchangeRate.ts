/**
 * `GET /v1/exchange-rate` (FC 008): the FIX the catalog uses, with its determination date.
 * 503 with a problem body while no FIX has ever been stored (prices then show in MXN only).
 *
 * @module
 */
import type { FastifyInstance } from 'fastify';
import { problem, PROBLEM_TYPE } from '../lib/problem';
import type { CurrentRate } from '../services/exchangeRate';

/**
 * Registers the exchange-rate route.
 *
 * @param app - Fastify instance.
 * @param rate - Current FIX provider (cached).
 */
export function registerExchangeRateRoute(
  app: FastifyInstance,
  rate: () => Promise<CurrentRate | null>
): void {
  app.get('/v1/exchange-rate', async (_request, reply) => {
    const current = await rate();
    if (!current) {
      return reply
        .code(503)
        .type(PROBLEM_TYPE)
        .send(
          problem(
            503,
            'Exchange rate unavailable',
            'No Banxico FIX stored yet.'
          )
        );
    }
    return current;
  });
}
