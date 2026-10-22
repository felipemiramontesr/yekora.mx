/**
 * `POST /v1/checkout` (FC 012 F2; not …/session: the A07 guard reserves that word for sign-in sessions): creates a pending order with its stock reserved and
 * a hosted payment session for the method the buyer chose. Each refusal of the truth tables is
 * an RFC 7807 problem whose `detail` is its machine code (T1.1: 503 SERVICE_UNAVAILABLE, 400
 * INVALID_SHIPPING_ADDRESS, 400 PRIVACY_CONSENT_REQUIRED; cart: 400 EMPTY_OR_UNAVAILABLE_CART;
 * T1.2: 400 UNSERVICEABLE_DESTINATION, 409 PRICE_CHANGED, 409 INSUFFICIENT_STOCK).
 *
 * Its rate limit (10/min per IP) is stricter than the cart's: each accepted call holds stock
 * for the method's reservation time, so automated calls must not be able to empty the shelves.
 *
 * @module
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { checkoutSessionSchema } from '../../../../lib/checkout/checkoutTypes';
import { problem, PROBLEM_TYPE } from '../lib/problem';
import { type CheckoutDeps, createCheckout } from '../services/checkout';

const lang = z.enum(['es-MX', 'en']).default('es-MX');

const TITLES: Record<string, string> = {
  INVALID_REQUEST: 'Invalid checkout request',
  SERVICE_UNAVAILABLE: 'Payments unavailable',
  INVALID_SHIPPING_ADDRESS: 'Invalid shipping address',
  PRIVACY_CONSENT_REQUIRED: 'Privacy consent required',
  EMPTY_OR_UNAVAILABLE_CART: 'Cart cannot be quoted',
  UNSERVICEABLE_DESTINATION: 'Destination not served',
  PRICE_CHANGED: 'Prices changed',
  INSUFFICIENT_STOCK: 'Insufficient stock',
};

/**
 * Registers the checkout route.
 *
 * @param app - Fastify instance.
 * @param deps - Checkout dependencies (database, rates, processors, configuration, clock).
 */
export function registerCheckoutRoutes(
  app: FastifyInstance,
  deps: CheckoutDeps
): void {
  app.post(
    '/v1/checkout',
    {
      bodyLimit: 16 * 1024,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const language = lang.safeParse(
        (request.query as { lang?: unknown }).lang
      );
      const outcome = language.success
        ? await createCheckout(deps, request.body, language.data)
        : ({ ok: false, status: 400, code: 'INVALID_REQUEST' } as const);
      if (!outcome.ok) {
        return reply
          .code(outcome.status)
          .type(PROBLEM_TYPE)
          .send(problem(outcome.status, TITLES[outcome.code], outcome.code));
      }
      return reply.code(201).send(checkoutSessionSchema.parse(outcome.session));
    }
  );
}
