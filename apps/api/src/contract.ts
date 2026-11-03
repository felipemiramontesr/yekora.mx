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
 * FC 028 adds the permission catalog for `/v1/account/*` and `/v1/admin/*` (T2.6): a route
 * under those prefixes is never public, except the 405 refusals of writes on orders (T2.6a),
 * which answer nothing else.
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
import {
  challengeRequestSchema,
  codeRequestSchema,
  confirmResponseSchema,
  enrollResponseSchema,
  loginRequestSchema,
  loginResponseSchema,
  meResponseSchema,
  registeredSchema,
  registerRequestSchema,
  signedInSchema,
} from '../../../lib/account/authTypes';
import {
  accountOrdersQuery,
  adminOrdersQuery,
  orderDetailSchema,
  orderPageSchema,
} from '../../../lib/account/orderTypes';
import { languageQuery } from './lib/language';
import type { Permission } from './lib/permissions';
import { problemSchema } from './lib/problem';
import { cartQuoteRequestSchema } from './routes/cart';
import { catalogItemParams, catalogListQuery } from './routes/catalog';
import {
  BEARER,
  ORDER_NUMBER,
  ORDER_PATHS,
  WRITE_METHODS,
} from './routes/orders';

/** Who may call a route: anyone, or the holders of one permission of the RBAC catalog. */
type Access = 'public' | Permission;

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
  method: 'GET' | 'POST' | (typeof WRITE_METHODS)[number];
  /** Path in Fastify syntax (`:param`). */
  path: string;
  /** One-line purpose. */
  summary: string;
  /** Permission that guards the route (app.ts runs the session guard for all but public). */
  permission: Access;
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

/** What the session guard answers instead of the route (lib/guard.ts). */
const SIGNED_IN_REFUSALS = {
  401: problemSchema,
  403: problemSchema,
  503: problemSchema,
} as const;

/** A public sign-in route: JSON body, its answers, 400 and 503 like every auth route. */
const auth = (
  path: string,
  summary: string,
  body: z.ZodType,
  responses: Readonly<Record<number, z.ZodType>>
): RouteContract => ({
  method: 'POST',
  path,
  summary,
  permission: 'public',
  request: { body },
  responses: { ...responses, 400: problemSchema, 503: problemSchema },
});

/** Path parameter of every one-order route. */
const orderParams = z.object({ order_number: z.string().regex(ORDER_NUMBER) });

/** The 405 of every write on an order path (FC 028 T2.6a): orders are read-only. */
const readOnly = (path: string): RouteContract[] =>
  WRITE_METHODS.map((method) => ({
    method,
    path,
    summary: 'Refused: orders are read-only in this delivery',
    permission: 'public',
    request: {},
    responses: { 405: problemSchema },
  }));

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
      params: orderParams,
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
  // FC 028: sign-up and sign-in are public by nature; everything signed-in is /v1/account.
  auth(
    '/v1/auth/register',
    'Creates a buyer account; never says whether the e-mail existed',
    registerRequestSchema,
    { 202: registeredSchema }
  ),
  auth(
    '/v1/auth/login',
    'Checks the password and opens a 5-minute second-factor challenge',
    loginRequestSchema,
    { 200: loginResponseSchema, 401: problemSchema }
  ),
  auth(
    '/v1/auth/totp/enroll',
    'Issues a new authenticator secret for the challenge’s user',
    challengeRequestSchema,
    { 200: enrollResponseSchema, 401: problemSchema, 409: problemSchema }
  ),
  auth(
    '/v1/auth/totp/confirm',
    'Turns the authenticator on, issues 8 backup codes and signs in',
    codeRequestSchema,
    { 200: confirmResponseSchema, 401: problemSchema, 409: problemSchema }
  ),
  auth(
    '/v1/auth/verify',
    'Signs in with the mailed code, an authenticator code or a backup code',
    codeRequestSchema,
    { 200: signedInSchema, 401: problemSchema, 409: problemSchema }
  ),
  {
    method: 'GET',
    path: '/v1/account/me',
    summary: 'The signed-in user, with its roles and permissions',
    permission: 'account:self',
    request: {},
    responses: { 200: meResponseSchema, ...SIGNED_IN_REFUSALS },
  },
  {
    method: 'POST',
    path: '/v1/account/logout',
    summary: 'Ends the session and clears its cookie',
    permission: 'account:self',
    request: {},
    responses: { 204: z.null(), ...SIGNED_IN_REFUSALS },
  },
  {
    method: 'GET',
    path: '/v1/account/orders',
    summary: "The signed-in buyer's own orders, newest first",
    permission: 'account:self',
    request: { query: accountOrdersQuery },
    responses: {
      200: orderPageSchema,
      400: problemSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
  {
    method: 'GET',
    path: '/v1/account/orders/:order_number',
    summary: 'One of the buyer’s orders, with its lines and payment events',
    permission: 'account:self',
    request: { params: orderParams },
    responses: {
      200: orderDetailSchema,
      404: problemSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
  {
    method: 'GET',
    path: '/v1/admin/orders',
    summary: 'Every order, newest first, optionally of one status',
    permission: 'orders:read',
    request: { query: adminOrdersQuery },
    responses: {
      200: orderPageSchema,
      400: problemSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
  {
    method: 'GET',
    path: '/v1/admin/orders/:order_number',
    summary: 'One order, with its lines and payment events',
    permission: 'orders:read',
    request: { params: orderParams },
    responses: {
      200: orderDetailSchema,
      404: problemSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
  ...ORDER_PATHS.flatMap(readOnly),
];
