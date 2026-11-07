/**
 * Account client (FC 028 F2): what `/cuenta` asks the API. Sign-up, sign-in with the second
 * factor, the session, and the read-only orders of the buyer and of the panel.
 *
 * Every request carries credentials, so the `__Host-yekora_session` cookie travels to
 * apiv1.yekora.mx (same site, so SameSite=Strict lets it through) and comes back set by the
 * sign-in. Sign-up and sign-in first solve the anti-bot challenge (Enmienda 1, E1). Like the other clients it never throws: offline, a timeout, an answer outside the
 * contract or a refusal become a typed reason, the refusal by its machine code (the problem's
 * `detail`), so the page can say exactly what happened.
 *
 * @module
 */
import { z } from 'zod';
import {
  botChallengeSchema,
  confirmResponseSchema,
  enrollResponseSchema,
  loginResponseSchema,
  meResponseSchema,
  registeredSchema,
  signedInSchema,
} from '@/lib/account/authTypes';
import { solveBotChallenge } from '@/lib/account/botSolver';
import {
  type OrderDetail,
  orderDetailSchema,
  orderPageSchema,
} from '@/lib/account/orderTypes';
import {
  API_URL,
  call,
  json,
  sessionRequest,
  type TransportFailure,
} from './http';

// FC 028 acceptance round 1 (282_AN P1): Hostinger puts the idle API to sleep, and the first request after a
// pause pays its whole start-up before the Argon2id work; 8 s was not enough for that request.
const TIMEOUT_MS = 25_000;

/** Refusals of `/v1/auth` and `/v1/account` the pages explain. */
const CODES = [
  'AUTH_UNAVAILABLE',
  'MAIL_UNAVAILABLE',
  'INVALID_REQUEST',
  'INVALID_CREDENTIALS',
  'INVALID_CHALLENGE',
  'INVALID_CODE',
  'TOTP_ALREADY_ENABLED',
  'TOTP_NOT_ENROLLED',
  'SESSION_INVALID_OR_EXPIRED',
  'SECOND_FACTOR_REQUIRED',
  'PERMISSION_DENIED',
  'DATA_DOMAIN_FORBIDDEN',
  'BOT_CHALLENGE_REQUIRED',
  'BOT_CHALLENGE_FAILED',
] as const;

/** Why a request gave no usable answer. */
export type AccountFailure =
  (typeof CODES)[number] | 'not_found' | 'rate_limited' | TransportFailure;

/** An answer of the API, or why there is none. */
type AccountResult<T> =
  { ok: true; data: T } | { ok: false; reason: AccountFailure };

/** Injectable fetch, for tests. */
interface ClientOptions {
  fetchImpl?: typeof fetch;
}

/** The answer of a refusal, by its machine code or its status. */
function refusal(status: number, body: unknown): AccountFailure {
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  const detail = (body as { detail?: unknown } | undefined)?.detail;
  return CODES.find((code) => code === detail) ?? 'server';
}

/** One request with the session cookie; the answer is checked against its schema. */
function request<T>(
  path: string,
  schema: z.ZodType<T>,
  { method = 'GET', body }: { method?: 'GET' | 'POST'; body?: object },
  { fetchImpl = fetch }: ClientOptions
): Promise<AccountResult<T>> {
  return sessionRequest(
    fetchImpl,
    path,
    {
      method,
      headers: body
        ? { Accept: 'application/json', 'Content-Type': 'application/json' }
        : { Accept: 'application/json' },
      body,
    },
    TIMEOUT_MS,
    schema,
    refusal
  );
}

/**
 * Fetches an anti-bot challenge and solves it (Enmienda 1, E1). A challenge no number solves can
 * only be forged, so it reads as an answer outside the contract.
 */
async function botProof(
  options: ClientOptions
): Promise<AccountResult<string>> {
  const challenge = await request(
    '/v1/auth/bot-challenge',
    botChallengeSchema,
    {},
    options
  );
  if (!challenge.ok) return challenge;
  const solution = await solveBotChallenge(challenge.data);
  return solution === null
    ? { ok: false, reason: 'invalid' }
    : { ok: true, data: solution };
}

/** A sign-up or sign-in request, sent with a freshly solved challenge. */
async function withProof<T>(
  path: string,
  schema: z.ZodType<T>,
  body: object,
  options: ClientOptions
): Promise<AccountResult<T>> {
  const proof = await botProof(options);
  if (!proof.ok) return proof;
  return request(
    path,
    schema,
    { method: 'POST', body: { ...body, altcha: proof.data } },
    options
  );
}

/**
 * Creates a buyer account. The API answers the same whether the e-mail existed or not.
 *
 * @param body - E-mail, password (12 to 128 characters) and full name.
 * @param options - Injectable fetch.
 * @returns Accepted, or why not.
 */
export function register(
  body: { email: string; password: string; fullName: string },
  options: ClientOptions = {}
) {
  return withProof('/v1/auth/register', registeredSchema, body, options);
}

/** What sign-in answers: a challenge whose code comes next, or signed in on a trusted device. */
const loginAnswerSchema = z.union([loginResponseSchema, signedInSchema]);

/**
 * Checks the password and opens a 5-minute challenge, unless this device is trusted (E2).
 *
 * @param body - E-mail and password.
 * @param options - Injectable fetch.
 * @returns The challenge and where its code comes from (mail or authenticator), or
 *   `{ status: 'signed_in' }` when a buyer's remembered device skips the code.
 */
export function login(
  body: { email: string; password: string },
  options: ClientOptions = {}
) {
  return withProof('/v1/auth/login', loginAnswerSchema, body, options);
}

/**
 * Sends the code of a challenge: the mailed one, an authenticator code or a backup code.
 *
 * @param body - Challenge id, code (6 or 8 digits) and whether to remember this device for 30
 *   days (buyers only; the API ignores it for staff).
 * @param options - Injectable fetch.
 * @returns Signed in (the cookie is set), or why not; `TOTP_NOT_ENROLLED` asks staff to
 *   enrol the authenticator with the same challenge.
 */
export function verify(
  body: { challengeId: string; code: string; rememberDevice?: boolean },
  options: ClientOptions = {}
) {
  return request(
    '/v1/auth/verify',
    signedInSchema,
    { method: 'POST', body },
    options
  );
}

/**
 * Asks for a new authenticator secret.
 *
 * @param challengeId - The challenge that passed the mailed code.
 * @param options - Injectable fetch.
 * @returns The secret in base32 and its `otpauth://` URI.
 */
export function enroll(challengeId: string, options: ClientOptions = {}) {
  return request(
    '/v1/auth/totp/enroll',
    enrollResponseSchema,
    { method: 'POST', body: { challengeId } },
    options
  );
}

/**
 * Turns the authenticator on with its first code, and signs in.
 *
 * @param body - Challenge id and the 6-digit code the app shows.
 * @param options - Injectable fetch.
 * @returns The 8 backup codes, shown this once.
 */
export function confirm(
  body: { challengeId: string; code: string },
  options: ClientOptions = {}
) {
  return request(
    '/v1/auth/totp/confirm',
    confirmResponseSchema,
    { method: 'POST', body },
    options
  );
}

/**
 * Who is signed in.
 *
 * @param options - Injectable fetch.
 * @returns The user with roles and permissions; `SESSION_INVALID_OR_EXPIRED` when signed out.
 */
export function me(options: ClientOptions = {}) {
  return request('/v1/account/me', meResponseSchema, {}, options);
}

/** A POST of the signed-in area that answers 204 with no body. */
async function emptyPost(
  path: string,
  { fetchImpl = fetch }: ClientOptions
): Promise<AccountResult<null>> {
  const answer = await call(
    fetchImpl,
    `${API_URL}${path}`,
    { method: 'POST', credentials: 'include' },
    TIMEOUT_MS
  );
  if (typeof answer === 'string') return { ok: false, reason: answer };
  return answer.ok
    ? { ok: true, data: null }
    : { ok: false, reason: refusal(answer.status, await json(answer)) };
}

/**
 * Ends the session; the API clears the cookie.
 *
 * @param options - Injectable fetch.
 * @returns Done, or why not.
 */
export function logout(options: ClientOptions = {}) {
  return emptyPost('/v1/account/logout', options);
}

/**
 * Forgets this device (Enmienda 1, E2): the next sign-in asks for the mailed code again.
 *
 * @param options - Injectable fetch.
 * @returns Done, or why not.
 */
export function forgetDevice(options: ClientOptions = {}) {
  return emptyPost('/v1/account/forget-device', options);
}

/** Whose orders: the buyer's own, or every order for the panel. */
export type OrderScope = 'account' | 'admin';

/**
 * One page of orders, newest first.
 *
 * @param scope - The buyer's own orders, or the panel's.
 * @param query - Page, and for the panel an optional status.
 * @param options - Injectable fetch.
 * @returns The page, or why not.
 */
export function listOrders(
  scope: OrderScope,
  query: { page: number; status?: string },
  options: ClientOptions = {}
) {
  const params = new URLSearchParams({ page: String(query.page) });
  if (query.status) params.set('status', query.status);
  return request(`/v1/${scope}/orders?${params}`, orderPageSchema, {}, options);
}

/**
 * One order with its lines and payment events.
 *
 * @param scope - The buyer's own order, or any order for the panel.
 * @param orderNumber - Public order number.
 * @param options - Injectable fetch.
 * @returns The order, or why not (`not_found`, `DATA_DOMAIN_FORBIDDEN`…).
 */
export function readOrder(
  scope: OrderScope,
  orderNumber: string,
  options: ClientOptions = {}
): Promise<AccountResult<OrderDetail>> {
  return request(
    `/v1/${scope}/orders/${encodeURIComponent(orderNumber)}`,
    orderDetailSchema,
    {},
    options
  );
}
