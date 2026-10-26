/**
 * `POST /v1/cart/quote` (FC 009 F1): the canonical quote of a guest cart.
 *
 * The body carries SKUs and quantities only, never prices (A04: the client never sets an
 * amount). It is validated with Zod before any query: at most 50 lines, unique SKUs of 1–64
 * characters (the `VARCHAR(64)` column) and quantities of 1–99; anything else is a 400 problem
 * (T1.1). Unknown or inactive SKUs are not an error: they come back as `unavailable` with a
 * warning (HTTP 200), so the cart can tell the buyer. The answer is validated too before it
 * leaves. This route has its own, stricter rate limit (60/min per IP) and a small body limit.
 *
 * FC 011: one canonical quote for cart and checkout, no parallel shipping route. With an
 * optional `destination` the same answer adds the shipping line (T1.1): a cart that is not
 * quotable or an unknown state is a 400 problem whose `detail` is the machine code
 * (EMPTY_OR_UNAVAILABLE_CART, INVALID_DESTINATION); a destination no rule covers is a 200 with
 * `serviceable: false`.
 *
 * @module
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
// One contract for both ends (FC 009, ADR 0008: shared Zod schemas): the browser stores and
// validates exactly what this route accepts and answers, so the two can never drift apart.
import {
  cartLinesSchema,
  cartQuoteSchema,
  destinationSchema,
} from '../../../../lib/cart/cartTypes';
import { problem, PROBLEM_TYPE } from '../lib/problem';
import { quoteCart, quoteCartToDestination } from '../services/cartQuote';
import type { Db } from '../services/db';
import type { CurrentRate } from '../services/exchangeRate';
import type { ShippingRateProvider } from '../services/shippingPort';

const requestSchema = z.strictObject({
  items: cartLinesSchema,
  destination: destinationSchema.optional(),
});

/** Title of each T1.1 rejection; the code itself travels as the problem detail. */
const REJECTION_TITLE = {
  EMPTY_OR_UNAVAILABLE_CART: 'Cart cannot be quoted',
  INVALID_DESTINATION: 'Invalid destination',
} as const;

const lang = z.enum(['es-MX', 'en']).default('es-MX');

/** Dependencies of the cart route. */
interface CartDeps {
  /** Database port. */
  db: Db;
  /** Current FIX (cached), or null when none is stored. */
  rate: () => Promise<CurrentRate | null>;
  /** Source of shipping rates (FC 011). */
  shipping: ShippingRateProvider;
}

/**
 * Registers the cart quote route.
 *
 * @param app - Fastify instance.
 * @param deps - Database, FIX provider and shipping rates.
 */
export function registerCartRoutes(app: FastifyInstance, deps: CartDeps): void {
  app.post(
    '/v1/cart/quote',
    {
      bodyLimit: 16 * 1024,
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const body = requestSchema.safeParse(request.body);
      const language = lang.safeParse(
        (request.query as { lang?: unknown }).lang
      );
      if (!body.success || !language.success) {
        return reply
          .code(400)
          .type(PROBLEM_TYPE)
          .send(
            problem(
              400,
              'Invalid cart',
              body.error?.issues[0]?.message ?? 'Invalid lang'
            )
          );
      }
      const { items, destination } = body.data;
      const rate = await deps.rate();
      if (destination === undefined) {
        return cartQuoteSchema.parse(
          await quoteCart(deps.db, items, rate, language.data)
        );
      }
      const result = await quoteCartToDestination(
        deps.db,
        items,
        rate,
        language.data,
        destination,
        deps.shipping
      );
      if (!result.ok) {
        return reply
          .code(400)
          .type(PROBLEM_TYPE)
          .send(problem(400, REJECTION_TITLE[result.code], result.code));
      }
      return cartQuoteSchema.parse(result.quote);
    }
  );
}
