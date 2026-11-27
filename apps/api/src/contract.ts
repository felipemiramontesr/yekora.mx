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
  adminProductPageSchema,
  adminProductSchema,
  brandCreate,
  brandPatch,
  brandSchema,
  facetGroupCreate,
  facetGroupPatch,
  facetGroupSchema,
  facetValueCreate,
  facetValuePatch,
  facetValueSchema,
  galleryPatch,
  mediaUploadedSchema,
  productCreate,
  productListQuery,
  productPatch,
  publishRequestedSchema,
  SAFE_IMAGE_TYPES,
} from '../../../lib/catalog/adminTypes';
import {
  exchangeRateSchema,
  productSchema,
} from '../../../lib/api/catalogClient';
import {
  fiscalProfileRequestSchema,
  fiscalProfileSavedSchema,
  fiscalProfileSchema,
} from '../../../lib/account/fiscalTypes';
import {
  paymentModeApprovalSchema,
  paymentModeConfirmSchema,
  paymentModePrepareSchema,
  paymentModeTicketSchema,
} from '../../../lib/account/paymentsBunkerTypes';
import {
  cashMovementResultSchema,
  cashMovementSchema,
  closedShiftSchema,
  closeShiftSchema,
  currentShiftSchema,
  openShiftSchema,
  posProductsQuery,
  posProductsSchema,
  posSaleResultSchema,
  posSaleSchema,
  posShiftSchema,
  receiptQuery,
  receiptSchema,
  shiftParams,
} from '../../../lib/account/posTypes';
import { paymentsHealthSchema } from '../../../lib/account/paymentsHealthTypes';
import { cartQuoteSchema } from '../../../lib/cart/cartTypes';
import {
  checkoutRequestSchema,
  checkoutSessionSchema,
  orderViewSchema,
} from '../../../lib/checkout/checkoutTypes';
import {
  addressListSchema,
  addressParams,
  addressPatchRequestSchema,
  addressSavedSchema,
  addressUpsertRequestSchema,
  profileUpdatedSchema,
  profileUpdateRequestSchema,
} from '../../../lib/account/addressTypes';
import {
  challengeRequestSchema,
  codeRequestSchema,
  confirmResponseSchema,
  enrollResponseSchema,
  loginRequestSchema,
  loginResponseSchema,
  forgotPasswordRequestSchema,
  forgotPasswordResponseSchema,
  meResponseSchema,
  registeredSchema,
  registerRequestSchema,
  resetCheckRequestSchema,
  resetCheckResponseSchema,
  resetPasswordRequestSchema,
  resetPasswordResponseSchema,
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
import {
  paymentMethodDetachResponseSchema,
  paymentMethodListResponseSchema,
  paymentMethodParams,
  paymentMethodSettleResponseSchema,
  paymentMethodSetupResponseSchema,
} from '../../../lib/account/paymentMethodTypes';
import { languageQuery } from './lib/language';
import {
  adminUserListSchema,
  adminUserParams,
  adminUserSchema,
} from '../../../lib/account/adminUserTypes';
import {
  fulfillmentResultSchema,
  shipRequestSchema,
} from '../../../lib/account/fulfillmentTypes';
import {
  roleCreateRequestSchema,
  roleListSchema,
  roleParams,
  rolePatchRequestSchema,
  roleSchema,
  staffCreateRequestSchema,
  staffUpdateRequestSchema,
} from '../../../lib/account/staffTypes';
import {
  posReturnRequestSchema,
  returnConfirmRequestSchema,
  returnListQuery,
  returnListSchema,
  returnParams,
  returnPrepareRequestSchema,
  returnRequestSchema,
  returnSchema,
} from '../../../lib/account/returnTypes';
import {
  shippingAdminViewSchema,
  shippingConfigRequestSchema,
  shippingRulesRequestSchema,
} from '../../../lib/account/shippingAdminTypes';
import type { Permission } from './lib/permissions';
import { problemSchema } from './lib/problem';
import { cartQuoteRequestSchema } from './routes/cart';
import { catalogItemParams, catalogListQuery } from './routes/catalog';
import { idParams, mutationHeaders } from './routes/catalogMutation';
import { mediaParams } from './routes/media';
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
    'Creates a buyer account; never says whether the e-mail existed. A password breaking the policy is a 400 naming the rule (FC 042); the account is born without an address (FC 055); an obsolete postalCode is accepted and ignored',
    registerRequestSchema,
    { 202: registeredSchema }
  ),
  // FC 042: «¿Olvidaste tu contraseña?», neutral for every e-mail, and the reset through its link.
  auth(
    '/v1/auth/forgot-password',
    'Mails a 15-minute reset link when the e-mail has an account; the same answer either way (10/min per IP and per e-mail)',
    forgotPasswordRequestSchema,
    { 200: forgotPasswordResponseSchema, 429: problemSchema }
  ),
  auth(
    '/v1/auth/reset-password',
    'Sets a new password through the mailed link, spends it and ends every session of the account',
    resetPasswordRequestSchema,
    { 200: resetPasswordResponseSchema }
  ),
  // FC 042 Enmienda 2: whose account a live link resets, without spending it.
  auth(
    '/v1/auth/reset-password/check',
    'Names the account of a live reset link (e-mail and name) without spending it; 400 when spent or expired (10/min per IP, no-store)',
    resetCheckRequestSchema,
    { 200: resetCheckResponseSchema }
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
    method: 'PATCH',
    path: '/v1/account/profile',
    summary:
      'Changes the name and the phone of the account; the e-mail never changes (FC 051)',
    permission: 'account:self',
    request: { headers: mutationHeaders, body: profileUpdateRequestSchema },
    responses: {
      200: profileUpdatedSchema,
      400: problemSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
  {
    method: 'GET',
    path: '/v1/account/fiscal-profile',
    summary: 'The fiscal data the account saved to be invoiced (FC 077)',
    permission: 'account:self',
    request: {},
    responses: {
      200: fiscalProfileSchema,
      404: problemSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
  {
    method: 'PUT',
    path: '/v1/account/fiscal-profile',
    summary:
      'Saves the fiscal data of the account, judged value by value; the answer repeats none of it (FC 077)',
    permission: 'account:self',
    request: { headers: mutationHeaders, body: fiscalProfileRequestSchema },
    responses: {
      200: fiscalProfileSavedSchema,
      400: problemSchema,
      409: problemSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
  {
    method: 'GET',
    path: '/v1/account/addresses',
    summary: 'The account’s book of delivery addresses, oldest first (FC 051)',
    permission: 'account:self',
    request: {},
    responses: { 200: addressListSchema, ...SIGNED_IN_REFUSALS },
  },
  {
    method: 'POST',
    path: '/v1/account/addresses',
    summary:
      'Adds a delivery address, up to five per account; the first one is the default (FC 051)',
    permission: 'account:self',
    request: { headers: mutationHeaders, body: addressUpsertRequestSchema },
    responses: {
      201: addressSavedSchema,
      400: problemSchema,
      409: problemSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
  {
    method: 'PATCH',
    path: '/v1/account/addresses/:id',
    summary:
      'Edits or completes an address, or makes it the default one; another account’s id is a 404 (FC 051)',
    permission: 'account:self',
    request: {
      params: addressParams,
      headers: mutationHeaders,
      body: addressPatchRequestSchema,
    },
    responses: {
      200: addressSavedSchema,
      400: problemSchema,
      404: problemSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
  {
    method: 'DELETE',
    path: '/v1/account/addresses/:id',
    summary:
      'Deletes an address; if it was the default the newest left takes its place (FC 051)',
    permission: 'account:self',
    request: { params: addressParams, headers: mutationHeaders },
    responses: {
      204: z.null(),
      400: problemSchema,
      404: problemSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
  {
    method: 'GET',
    path: '/v1/account/payment-methods',
    summary:
      'The cards the account keeps at Stripe: brand, last four and expiry, read from Stripe each time (FC 054)',
    permission: 'account:self',
    request: {},
    responses: {
      200: paymentMethodListResponseSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
  {
    method: 'POST',
    path: '/v1/account/payment-methods/setup',
    summary:
      'Opens the hosted page of Stripe where the account adds a card; the card never reaches this API (FC 054)',
    permission: 'account:self',
    request: { query: languageQuery, headers: mutationHeaders },
    responses: {
      201: paymentMethodSetupResponseSchema,
      400: problemSchema,
      409: problemSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
  {
    method: 'POST',
    path: '/v1/account/payment-methods/settle',
    summary:
      'Leaves the account with its newest card at Stripe and detaches the older ones: one card per account (FC 057)',
    permission: 'account:self',
    request: { headers: mutationHeaders },
    responses: {
      200: paymentMethodSettleResponseSchema,
      400: problemSchema,
      409: problemSchema,
      502: problemSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
  {
    method: 'DELETE',
    path: '/v1/account/payment-methods/:id',
    summary:
      'Detaches a card of the account at Stripe; another account’s card is a 404 (FC 054)',
    permission: 'account:self',
    request: { params: paymentMethodParams, headers: mutationHeaders },
    responses: {
      200: paymentMethodDetachResponseSchema,
      400: problemSchema,
      404: problemSchema,
      409: problemSchema,
      ...SIGNED_IN_REFUSALS,
    },
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
    path: '/v1/admin/payments/health',
    summary:
      'The payments mode and whether each processor answers (no secret, audited)',
    permission: 'orders:read',
    request: {},
    responses: {
      200: paymentsHealthSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
  {
    method: 'GET',
    path: '/v1/admin/pos/shifts/current',
    summary: 'The open till shift, without its expected cash (blind count)',
    permission: 'pos:shift',
    request: {},
    responses: {
      200: currentShiftSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
  {
    method: 'POST',
    path: '/v1/admin/pos/shifts/open',
    summary: 'Opens the till shift; one at a time (Idempotency-Key, audited)',
    permission: 'pos:shift',
    request: { body: openShiftSchema },
    responses: {
      201: posShiftSchema,
      400: problemSchema,
      409: problemSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
  {
    method: 'POST',
    path: '/v1/admin/pos/shifts/movements',
    summary:
      'Cash put in or taken out of the drawer (T1.4, Idempotency-Key, audited)',
    permission: 'pos:shift',
    request: { body: cashMovementSchema },
    responses: {
      201: cashMovementResultSchema,
      400: problemSchema,
      409: problemSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
  {
    method: 'POST',
    path: '/v1/admin/pos/shifts/:id/close',
    summary:
      'Closes the shift with a blind count (T1.2, Idempotency-Key, audited)',
    permission: 'pos:shift',
    request: { params: shiftParams, body: closeShiftSchema },
    responses: {
      200: closedShiftSchema,
      400: problemSchema,
      409: problemSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
  {
    method: 'GET',
    path: '/v1/admin/pos/products',
    summary:
      'The products of the counter, with what is left after online reservations',
    permission: 'pos:sell',
    request: { query: posProductsQuery },
    responses: {
      200: posProductsSchema,
      400: problemSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
  {
    method: 'POST',
    path: '/v1/admin/pos/checkout',
    summary:
      'Sells at the counter from the shared stock (T1.1, T1.3, Idempotency-Key, audited)',
    permission: 'pos:sell',
    request: { body: posSaleSchema },
    responses: {
      201: posSaleResultSchema,
      400: problemSchema,
      409: problemSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
  {
    method: 'GET',
    path: '/v1/admin/pos/orders/:order_number/receipt',
    summary: 'The thermal receipt of a counter sale, 80 or 58 mm',
    permission: 'pos:sell',
    request: {
      params: z.object({ order_number: z.string() }),
      query: receiptQuery,
    },
    responses: {
      200: receiptSchema,
      400: problemSchema,
      404: problemSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
  {
    method: 'POST',
    path: '/v1/admin/payments/mode/prepare',
    summary:
      'The owner or an administrator asks to change the payments mode: a ticket of ten minutes (audited)',
    permission: 'users:manage',
    request: { body: paymentModePrepareSchema },
    responses: {
      201: paymentModeTicketSchema,
      400: problemSchema,
      409: problemSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
  {
    method: 'POST',
    path: '/v1/admin/payments/mode/confirm',
    summary:
      'The owner confirms the ticket with the phrase and the second factor: an approval the start of the API demands (audited)',
    permission: 'users:manage',
    request: { body: paymentModeConfirmSchema },
    responses: {
      200: paymentModeApprovalSchema,
      400: problemSchema,
      409: problemSchema,
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
  // FC 068 F1: the fulfillment of a paid order. Every step needs orders:manage and an Idempotency-Key.
  ...(['prepare', 'ship', 'deliver'] as const).map((step): RouteContract => ({
    method: 'POST',
    path: `/v1/admin/orders/:order_number/${step}`,
    summary: {
      prepare: 'Moves a paid order to PREPARING and tells the buyer (audited)',
      ship: 'Registers the carrier and the tracking number, moves the order to SHIPPED and tells the buyer (audited)',
      deliver: 'Moves a shipped order to DELIVERED (audited)',
    }[step],
    permission: 'orders:manage',
    request: {
      params: orderParams,
      headers: mutationHeaders,
      ...(step === 'ship' && { body: shipRequestSchema }),
    },
    responses: {
      200: fulfillmentResultSchema,
      400: problemSchema,
      404: problemSchema,
      409: problemSchema,
      ...SIGNED_IN_REFUSALS,
    },
  })),
  // FC 072 F1: the staff, the roles and the matrix. The owner and the administrator list and manage
  // the staff by the hierarchy; only the owner creates and edits roles.
  {
    method: 'GET',
    path: '/v1/admin/users',
    summary:
      'The staff the actor may see: all of it for the owner, the sellers and support roles for an administrator',
    permission: 'sellers:manage',
    request: {},
    responses: { 200: adminUserListSchema, ...SIGNED_IN_REFUSALS },
  },
  {
    method: 'POST',
    path: '/v1/admin/users',
    summary:
      'Brings a person into the staff with its roles and a 15-minute link, no password (audited)',
    permission: 'sellers:manage',
    request: { headers: mutationHeaders, body: staffCreateRequestSchema },
    responses: {
      201: adminUserSchema,
      400: problemSchema,
      409: problemSchema,
      422: problemSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
  {
    method: 'PATCH',
    path: '/v1/admin/users/:id',
    summary:
      'Switches an account of the staff on or off or replaces its roles, ending its sessions (audited)',
    permission: 'sellers:manage',
    request: {
      params: adminUserParams,
      headers: mutationHeaders,
      body: staffUpdateRequestSchema,
    },
    responses: {
      200: adminUserSchema,
      400: problemSchema,
      404: problemSchema,
      422: problemSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
  {
    method: 'GET',
    path: '/v1/admin/roles',
    summary:
      'The roles with their permissions and the catalog the matrix is made of',
    permission: 'sellers:manage',
    request: {},
    responses: { 200: roleListSchema, ...SIGNED_IN_REFUSALS },
  },
  {
    method: 'POST',
    path: '/v1/admin/roles',
    summary:
      'Creates a role of support with its matrix; only the owner (audited)',
    permission: 'roles:manage',
    request: { headers: mutationHeaders, body: roleCreateRequestSchema },
    responses: {
      201: roleSchema,
      400: problemSchema,
      409: problemSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
  {
    method: 'PATCH',
    path: '/v1/admin/roles/:id',
    summary:
      'Edits a role and its matrix; only the owner, never a role of the system (audited)',
    permission: 'roles:manage',
    request: {
      params: roleParams,
      headers: mutationHeaders,
      body: rolePatchRequestSchema,
    },
    responses: {
      200: roleSchema,
      400: problemSchema,
      404: problemSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
  // FC 071 F1: the returns. The buyer asks; the board lists; one operator prepares, another confirms.
  {
    method: 'POST',
    path: '/v1/account/orders/:order_number/returns',
    summary:
      'The buyer asks to return units of a delivered order within 60 days (audited)',
    permission: 'account:self',
    request: {
      params: orderParams,
      headers: mutationHeaders,
      body: returnRequestSchema,
    },
    responses: {
      201: returnSchema,
      400: problemSchema,
      404: problemSchema,
      409: problemSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
  {
    method: 'GET',
    path: '/v1/admin/returns',
    summary: 'The board of returns, newest first, optionally of one stage',
    permission: 'returns:view',
    request: { query: returnListQuery },
    responses: {
      200: returnListSchema,
      400: problemSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
  {
    method: 'POST',
    path: '/v1/admin/returns/pos',
    summary:
      'The staff asks for the return of a counter sale (Idempotency-Key, audited)',
    permission: 'returns:prepare',
    request: { body: posReturnRequestSchema },
    responses: {
      201: returnSchema,
      400: problemSchema,
      404: problemSchema,
      409: problemSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
  {
    method: 'POST',
    path: '/v1/admin/returns/:id/prepare',
    summary:
      'Sets the amount to refund and whether the units go back to the shelf (audited)',
    permission: 'returns:prepare',
    request: {
      params: returnParams,
      headers: mutationHeaders,
      body: returnPrepareRequestSchema,
    },
    responses: {
      200: returnSchema,
      400: problemSchema,
      404: problemSchema,
      409: problemSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
  {
    method: 'POST',
    path: '/v1/admin/returns/:id/confirm',
    summary:
      'Another operator confirms and executes the refund through the processor (audited, four eyes)',
    permission: 'returns:confirm',
    request: { params: returnParams, body: returnConfirmRequestSchema },
    responses: {
      200: returnSchema,
      400: problemSchema,
      404: problemSchema,
      409: problemSchema,
      502: problemSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
  // FC 061 F1: the shipping console. Every write needs shipping:manage and an Idempotency-Key.
  {
    method: 'GET',
    path: '/v1/admin/shipping',
    summary:
      'The shipping configuration, its catalogs and the rate of each of the 32 states',
    permission: 'shipping:manage',
    request: {},
    responses: { 200: shippingAdminViewSchema, ...SIGNED_IN_REFUSALS },
  },
  {
    method: 'PUT',
    path: '/v1/admin/shipping/config',
    summary: 'Sets the active strategy and free shipping (audited)',
    permission: 'shipping:manage',
    request: { headers: mutationHeaders, body: shippingConfigRequestSchema },
    responses: {
      200: shippingAdminViewSchema,
      400: problemSchema,
      409: problemSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
  {
    method: 'PUT',
    path: '/v1/admin/shipping/rules',
    summary:
      'Replaces the ZONE_RATE rate of the 32 states atomically (audited)',
    permission: 'shipping:manage',
    request: { headers: mutationHeaders, body: shippingRulesRequestSchema },
    responses: {
      200: shippingAdminViewSchema,
      400: problemSchema,
      ...SIGNED_IN_REFUSALS,
    },
  },
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
    'Create a product with its property values (FC 048: no level)',
    { body: productCreate, answer: adminProductSchema, references: true }
  ),
  catalogWrite(
    'PATCH',
    '/v1/admin/catalog/products/:id',
    'Edit or retire a product; SKU and slug are fixed; a list of property values replaces its own',
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
