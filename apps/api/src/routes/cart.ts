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
 * @module
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { problem, PROBLEM_TYPE } from '../lib/problem';
import { quoteCart } from '../services/cartQuote';
import type { Db } from '../services/db';
import type { CurrentRate } from '../services/exchangeRate';

const MAX_LINES = 50;

const requestSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            sku: z.string().min(1).max(64),
            quantity: z.number().int().min(1).max(99),
          })
          .strict()
      )
      .max(MAX_LINES),
  })
  .strict()
  .refine(
    ({ items }) => new Set(items.map((item) => item.sku)).size === items.length,
    { message: 'Each SKU may appear only once' }
  );

const lang = z.enum(['es-MX', 'en']).default('es-MX');

const cents = z.number().int();
const responseSchema = z.object({
  items: z.array(
    z.object({
      sku: z.string(),
      slug: z.string().nullable(),
      name: z.string().nullable(),
      quantity: cents.min(1),
      unitPriceMxnCents: cents.positive().nullable(),
      lineTotalMxnCents: cents.nonnegative().nullable(),
      lineBaseMxnCents: cents.nonnegative().nullable(),
      lineTaxMxnCents: cents.nonnegative().nullable(),
      stockStatus: z.enum([
        'available',
        'low_stock',
        'out_of_stock',
        'unavailable',
      ]),
      availableQuantity: cents.min(0).max(99),
      purchasable: z.boolean(),
    })
  ),
  summary: z
    .object({
      subtotalMxnCents: cents.nonnegative(),
      taxMxnCents: cents.nonnegative(),
      totalMxnCents: cents.nonnegative(),
      totalItems: cents.nonnegative(),
      referenceUsdCents: cents.nonnegative().nullable(),
      exchangeRate: z
        .object({ series: z.string(), date: z.string(), rate: z.string() })
        .nullable(),
    })
    // T1.3: the VAT breakdown always adds up to the total.
    .refine((s) => s.subtotalMxnCents + s.taxMxnCents === s.totalMxnCents),
  warnings: z.array(
    z.object({
      sku: z.string(),
      code: z.enum(['unavailable', 'out_of_stock', 'insufficient_stock']),
    })
  ),
});

/** Dependencies of the cart route. */
interface CartDeps {
  /** Database port. */
  db: Db;
  /** Current FIX (cached), or null when none is stored. */
  rate: () => Promise<CurrentRate | null>;
}

/**
 * Registers the cart quote route.
 *
 * @param app - Fastify instance.
 * @param deps - Database and FIX provider.
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
      const quote = await quoteCart(
        deps.db,
        body.data.items,
        await deps.rate(),
        language.data
      );
      return responseSchema.parse(quote);
    }
  );
}
