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
  verifyRequestSchema,
  botChallengeSchema,
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
import { mediaUploadedSchema } from './routes/catalogAdmin';
import {
  brandCreate,
  brandPatch,
  brandSchema,
  facetGroupCreate,
  facetGroupPatch,
  facetGroupSchema,
  facetValueCreate,
  facetValuePatch,
  facetValueSchema,
} from './routes/catalogEntities';
import { idParams, mutationHeaders } from './routes/catalogMutation';
import { publishRequestedSchema } from './routes/catalogPublish';
import {
  adminProductPageSchema,
  adminProductSchema,
  galleryPatch,
  productCreate,
  productListQuery,
  productPatch,
} from './routes/catalogProducts';
import { mediaParams } from './routes/media';
import { SAFE_IMAGE_TYPES } from './services/imageProbe';
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
  /** Media types of a binary 200 (images), instead of JSON; its schema is {@link binarySchema}. */
  binary?: readonly string[];
}

/** A 200 that is raw bytes, not JSON (FC 029 F1: an image served by digest). */
const binarySchema = z.custom<Buffer>((value) => Buffer.isBuffer(value));

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

/** The 422 of a write that names other rows (FC 029 F2b2: an unknown or retired reference). */
const UNPROCESSABLE: Readonly<Record<number, z.ZodType>> = {
  422: problemSchema,
};

/** A backoffice list (FC 029 F2b): needs catalog:write, answers every row. */
const catalogRead = (
  path: string,
  summary: string,
  item: z.ZodType
): RouteContract => ({
  method: 'GET',
  path,
  summary,
  permission: 'catalog:write',
  request: {},
  responses: { 200: z.array(item), ...SIGNED_IN_REFUSALS },
});

/**
 * A backoffice write (FC 029 F2b, routes/catalogMutation.ts): Idempotency-Key, JSON body, 201
 * when it creates and 200 when it edits, and every refusal of the mutation pipeline.
 */
const catalogWrite = (
  method: 'POST' | 'PATCH',
  path: string,
  summary: string,
  shape: {
    params?: z.ZodType;
    body: z.ZodType;
    answer: z.ZodType;
    /** Products refer to other rows: an unknown or retired one is a 422. */
    references?: true;
  }
): RouteContract => ({
  method,
  path,
  summary,
  permission: 'catalog:write',
  request: { params: shape.params, headers: mutationHeaders, body: shape.body },
  responses: {
    [method === 'POST' ? 201 : 200]: shape.answer,
    400: problemSchema,
    404: problemSchema,
    409: problemSchema,
    ...(shape.references ? UNPROCESSABLE : {}),
    ...SIGNED_IN_REFUSALS,
  },
});

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
    method: 'GET',
    path: '/v1/media/:sha256',
    summary:
      'One product image by the SHA-256 of its bytes, cacheable as immutable',
    permission: 'public',
    request: { params: mediaParams },
    responses: {
      200: binarySchema,
      400: problemSchema,
      404: problemSchema,
      500: problemSchema,
    },
    binary: SAFE_IMAGE_TYPES,
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
  {
    method: 'GET',
    path: '/v1/auth/bot-challenge',
    summary:
      'A proof-of-work challenge for sign-up and sign-in (ALTCHA format, 30/min)',
    permission: 'public',
    request: {},
    responses: { 200: botChallengeSchema, 503: problemSchema },
  },
  auth(
    '/v1/auth/login',
    'Checks the password; opens a 5-minute second-factor challenge, or signs a buyer in on a trusted device (201)',
    loginRequestSchema,
    { 200: loginResponseSchema, 201: signedInSchema, 401: problemSchema }
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
    'Signs in with the mailed code, an authenticator code or a backup code; may remember a buyer’s device',
    verifyRequestSchema,
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
    path: '/v1/account/forget-device',
    summary: 'Forgets this browser’s trusted device and expires its cookie',
    permission: 'account:self',
    request: {},
    responses: { 204: z.null(), ...SIGNED_IN_REFUSALS },
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
  // FC 029 F2: the catalog backoffice. Every write needs catalog:write and an Idempotency-Key.
  {
    method: 'POST',
    path: '/v1/admin/catalog/media',
    summary:
      'Upload one cropped image (raw WebP, JPEG or PNG bytes), stored once per SHA-256',
    permission: 'catalog:write',
    request: { headers: mutationHeaders, rawBody: true },
    responses: {
      201: mediaUploadedSchema,
      400: problemSchema,
      409: problemSchema,
      413: problemSchema,
      415: problemSchema,
      422: problemSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
  {
    method: 'DELETE',
    path: '/v1/admin/catalog/*',
    summary:
      'Refused: nothing in the catalog is deleted; retiring is is_active = 0',
    permission: 'catalog:write',
    request: {},
    responses: { 405: problemSchema, ...SIGNED_IN_REFUSALS },
  },
  catalogRead(
    '/v1/admin/catalog/brands',
    'Every brand, active or not',
    brandSchema
  ),
  catalogRead(
    '/v1/admin/catalog/facets',
    'Every facet group with its values, active or not',
    facetGroupSchema
  ),
  catalogWrite('POST', '/v1/admin/catalog/brands', 'Create a brand', {
    body: brandCreate,
    answer: brandSchema,
  }),
  catalogWrite(
    'PATCH',
    '/v1/admin/catalog/brands/:id',
    'Edit or retire a brand (isActive: false)',
    { params: idParams, body: brandPatch, answer: brandSchema }
  ),
  catalogWrite(
    'POST',
    '/v1/admin/catalog/facet-groups',
    'Create a facet group',
    {
      body: facetGroupCreate,
      answer: facetGroupSchema,
    }
  ),
  catalogWrite(
    'PATCH',
    '/v1/admin/catalog/facet-groups/:id',
    'Edit or retire a facet group; the system group Nivel is never retired',
    { params: idParams, body: facetGroupPatch, answer: facetGroupSchema }
  ),
  catalogWrite(
    'POST',
    '/v1/admin/catalog/facet-groups/:id/values',
    'Add a value to a facet group (not to the system group)',
    { params: idParams, body: facetValueCreate, answer: facetValueSchema }
  ),
  catalogWrite(
    'PATCH',
    '/v1/admin/catalog/facet-values/:id',
    'Relabel or reorder a facet value (not of the system group)',
    { params: idParams, body: facetValuePatch, answer: facetValueSchema }
  ),
  {
    method: 'GET',
    path: '/v1/admin/catalog/products',
    summary: 'One page of every product, active or not, by Spanish name',
    permission: 'catalog:write',
    request: { query: productListQuery },
    responses: {
      200: adminProductPageSchema,
      400: problemSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
  {
    method: 'GET',
    path: '/v1/admin/catalog/products/:id',
    summary: 'One product with its facet values and gallery, active or not',
    permission: 'catalog:write',
    request: { params: idParams },
    responses: {
      200: adminProductSchema,
      400: problemSchema,
      404: problemSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
  catalogWrite(
    'POST',
    '/v1/admin/catalog/products',
    'Create a product; its level links the system group Nivel (T2.6)',
    { body: productCreate, answer: adminProductSchema, references: true }
  ),
  catalogWrite(
    'PATCH',
    '/v1/admin/catalog/products/:id',
    'Edit or retire a product; SKU and slug are fixed, level and Nivel move together',
    {
      params: idParams,
      body: productPatch,
      answer: adminProductSchema,
      references: true,
    }
  ),
  catalogWrite(
    'PATCH',
    '/v1/admin/catalog/products/:id/media',
    'Replace the gallery in order (first is primary); images that leave are retired',
    {
      params: idParams,
      body: galleryPatch,
      answer: adminProductSchema,
      references: true,
    }
  ),
  {
    method: 'POST',
    path: '/v1/admin/catalog/publish',
    summary:
      'Rebuild the store: dispatch deploy.yml on main, through every gate (FC 029 T2.5)',
    permission: 'catalog:write',
    request: { headers: mutationHeaders },
    responses: {
      202: publishRequestedSchema,
      400: problemSchema,
      409: problemSchema,
      502: problemSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
];
