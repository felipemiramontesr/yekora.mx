/**
 * The API contract (FC 027 Q03, ADR 0014): one entry per route Fastify serves, with the
 * permission that guards it, the Zod schemas of its request and the schema of every answer.
 *
 * The request schemas are the very ones the routes parse (imported, not copied), and the
 * answers reuse the schemas the site already validates against. scripts/checkApiContract.ts turns
 * this registry into apps/api/openapi.json (OpenAPI 3.1) and refuses breaking changes;
 * app.ts refuses to register a route missing here, and scripts/lib/contractValidation.test.ts
 * proves both sets are equal.
 *
 * Every route is `public` today. FC 028 adds the permission catalog for `/v1/account/*` and
 * `/v1/admin/*` (T2.6): a route under those prefixes can never be public.
 *
 * @module
 */
import { z } from 'zod';
import {
  exchangeRateSchema,
  productSchema,
} from '../../../lib/api/catalogClient';
import { cartQuoteSchema } from '../../../lib/cart/cartTypes';
import {
  checkoutRequestSchema,
  checkoutSessionSchema,
  orderViewSchema,
} from '../../../lib/checkout/checkoutTypes';
import { languageQuery } from './lib/language';
import { problemSchema } from './lib/problem';
import { cartQuoteRequestSchema } from './routes/cart';
import { catalogItemParams, catalogListQuery } from './routes/catalog';
import { BEARER, ORDER_NUMBER } from './routes/orders';

/** Who may call a route. FC 028 widens it with the permissions of the RBAC catalog. */
type Permission = 'public';

/** What one route accepts. */
interface RequestContract {
  /** Path parameters. */
  params?: z.ZodType;
  /** Query parameters. */
  query?: z.ZodType;
  /** Headers the route reads. */
  headers?: z.ZodType;
  /** JSON body. */
  body?: z.ZodType;
  /** True when the body is read as raw bytes (signed webhooks). */
  rawBody?: true;
}

/** One route of the API. */
interface RouteContract {
  /** HTTP method. */
  method: 'GET' | 'POST';
  /** Path in Fastify syntax (`:param`). */
  path: string;
  /** One-line purpose. */
  summary: string;
  /** Permission that guards the route. */
  permission: Permission;
  /** What the route accepts. */
  request: RequestContract;
  /** Schema of each answer by status; {@link problemSchema} marks an RFC 7807 error. */
  responses: Readonly<Record<number, z.ZodType>>;
}

const healthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  sha: z.string(),
  db: z.enum(['connected', 'unreachable']),
});

const catalogItemSchema = productSchema.omit({ images: true });

const catalogPageSchema = z.object({
  items: z.array(catalogItemSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  exchangeRate: exchangeRateSchema.nullable(),
});

const catalogProductSchema = productSchema.extend({
  exchangeRate: exchangeRateSchema.nullable(),
});

const webhookAckSchema = z.object({ code: z.string() });

const webhook = (processor: string, path: string): RouteContract => ({
  method: 'POST',
  path,
  summary: `${processor} payment notification, verified by signature`,
  permission: 'public',
  request: { rawBody: true },
  responses: {
    200: webhookAckSchema,
    401: problemSchema,
    500: problemSchema,
    503: problemSchema,
  },
});

/** Every route the API serves, in registration order (app.ts). */
export const ROUTE_CONTRACTS: readonly RouteContract[] = [
  {
    method: 'GET',
    path: '/health',
    summary: 'Liveness, deployed version and database reachability',
    permission: 'public',
    request: {},
    responses: { 200: healthSchema, 503: healthSchema },
  },
  {
    method: 'GET',
    path: '/v1/catalog',
    summary: 'Active products, filtered, sorted and paged, in one language',
    permission: 'public',
    request: { query: catalogListQuery },
    responses: { 200: catalogPageSchema, 400: problemSchema },
  },
  {
    method: 'GET',
    path: '/v1/catalog/:slug',
    summary: 'One active product with its gallery, in one language',
    permission: 'public',
    request: { params: catalogItemParams, query: languageQuery },
    responses: {
      200: catalogProductSchema,
      400: problemSchema,
      404: problemSchema,
    },
  },
  {
    method: 'POST',
    path: '/v1/cart/quote',
    summary:
      'Canonical quote of a guest cart, with shipping when a destination is given',
    permission: 'public',
    request: { query: languageQuery, body: cartQuoteRequestSchema },
    responses: { 200: cartQuoteSchema, 400: problemSchema },
  },
  {
    method: 'GET',
    path: '/v1/exchange-rate',
    summary: 'Banxico FIX used for the USD reference',
    permission: 'public',
    request: {},
    responses: { 200: exchangeRateSchema, 503: problemSchema },
  },
  {
    method: 'POST',
    path: '/v1/checkout',
    summary: 'Pending order with reserved stock and a hosted payment session',
    permission: 'public',
    request: { query: languageQuery, body: checkoutRequestSchema },
    responses: {
      201: checkoutSessionSchema,
      400: problemSchema,
      409: problemSchema,
      503: problemSchema,
    },
  },
  {
    method: 'GET',
    path: '/v1/orders/:order_number',
    summary: "The buyer's view of one order, behind its access token",
    permission: 'public',
    request: {
      params: z.object({ order_number: z.string().regex(ORDER_NUMBER) }),
      headers: z.object({ authorization: z.string().regex(BEARER) }),
    },
    responses: {
      200: orderViewSchema,
      404: problemSchema,
      503: problemSchema,
    },
  },
  webhook('Stripe', '/v1/webhooks/stripe'),
  webhook('Mercado Pago', '/v1/webhooks/mercadopago'),
];
