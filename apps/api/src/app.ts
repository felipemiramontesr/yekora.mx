/**
 * The Fastify application (FC 008, ADR 0006), built from injected dependencies so tests run it
 * in memory with `app.inject()` and no network or database.
 *
 * Security layers, in order:
 * - Helmet headers;
 * - CORS limited to the site's origins;
 * - a per-IP rate limit;
 * - RFC 7807 errors without stack traces or internal details (OWASP A05).
 * Logs are JSON, and the `authorization` and `cookie` headers are redacted.
 *
 * @module
 */
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { CORS_ORIGINS, type ApiConfig } from './config';
import { problem, PROBLEM_TYPE } from './lib/problem';
import { registerCartRoutes } from './routes/cart';
import { registerCatalogRoutes } from './routes/catalog';
import { registerCheckoutRoutes } from './routes/checkout';
import { registerExchangeRateRoute } from './routes/exchangeRate';
import { registerOrderRoutes } from './routes/orders';
import { registerWebhookRoutes } from './routes/webhooks';
import type { CheckoutDeps } from './services/checkout';
import type { Db, Transactional } from './services/db';
import type { CurrentRate } from './services/exchangeRate';
import { createMercadoPagoAdapter } from './services/mercadoPagoAdapter';
import { createTableRateProvider } from './services/shippingRates';
import { createStripeAdapter } from './services/stripeAdapter';

/** Everything the application needs, injected by index.ts or by tests. */
interface AppDeps {
  /** Validated configuration. */
  config: ApiConfig;
  /** Database port, with transactions for the checkout (FC 012). */
  db: Db & Transactional;
  /** Current FIX provider (cached). */
  rate: () => Promise<CurrentRate | null>;
  /** Fastify logger: true in production, false in tests. */
  logger: boolean;
  /** Payment processors; by default built from the configured secrets (tests inject doubles). */
  processors?: CheckoutDeps['processors'];
  /** Clock of the checkout; the real one by default. */
  now?: () => Date;
}

/** The processors whose secrets are configured; the others stay absent (T1.1 K = ⊥). */
function configuredProcessors(config: ApiConfig): CheckoutDeps['processors'] {
  const { stripe, mercadoPago } = config.payments;
  return {
    ...(stripe && { STRIPE: createStripeAdapter(stripe) }),
    ...(mercadoPago && { MERCADO_PAGO: createMercadoPagoAdapter(mercadoPago) }),
  };
}

/**
 * Builds the API with its plugins and routes.
 *
 * @param deps - Configuration, database, FIX provider and logger switch.
 * @returns A ready-to-listen Fastify instance.
 */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.logger && {
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    trustProxy: true,
  });
  await app.register(helmet);
  // FC 009: POST only for the cart quote; the origins stay the site and the local servers.
  await app.register(cors, { origin: CORS_ORIGINS, methods: ['GET', 'POST'] });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const status =
      error.statusCode && error.statusCode < 500 ? error.statusCode : 500;
    if (status === 500) app.log.error(error);
    return reply
      .code(status)
      .type(PROBLEM_TYPE)
      .send(problem(status, status === 500 ? 'Internal error' : error.message));
  });
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).type(PROBLEM_TYPE).send(problem(404, 'Not found'))
  );

  app.get('/health', async (_request, reply) => {
    const base = { version: deps.config.version, sha: deps.config.sha };
    try {
      await deps.db.ping();
      return { status: 'ok', ...base, db: 'connected' };
    } catch {
      return reply
        .code(503)
        .send({ status: 'degraded', ...base, db: 'unreachable' });
    }
  });
  registerCatalogRoutes(app, { db: deps.db, rate: deps.rate });
  // FC 011: shipping is priced from the rate tables of the same database (no network in v1).
  const shipping = createTableRateProvider(deps.db);
  registerCartRoutes(app, { db: deps.db, rate: deps.rate, shipping });
  registerExchangeRateRoute(app, deps.rate);
  // FC 012: checkout and the buyer's order view; closed (503) while payments are not configured.
  const now = deps.now ?? (() => new Date());
  const processors = deps.processors ?? configuredProcessors(deps.config);
  registerCheckoutRoutes(app, {
    db: deps.db,
    rate: deps.rate,
    shipping,
    processors,
    payments: deps.config.payments,
    now,
  });
  registerOrderRoutes(app, {
    db: deps.db,
    payments: deps.config.payments,
    now,
  });
  await registerWebhookRoutes(app, {
    db: deps.db,
    processors,
    payments: deps.config.payments,
    now,
  });
  return app;
}
