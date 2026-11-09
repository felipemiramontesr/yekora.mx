import { createHash } from 'node:crypto';
import type { Page, Route } from '@playwright/test';
import {
  PASSWORD_PROBLEMS,
  type PasswordContext,
  passwordViolation,
} from '../../lib/account/passwordPolicy';

/**
 * The account API as the E2E suites see it (FC 028 F2): `/v1/auth/*` and `/v1/account/*`,
 * `/v1/admin/*` intercepted in the browser, with a session that only opens after the right code,
 * so no test ever reaches production. Sign-in asks for a solved anti-bot challenge and honours a
 * remembered device (FC 028 Enmienda 1, E1 and E2), as the real API does. Shared by account.spec.ts, a11y.spec.ts and
 * responsive.spec.ts (signed out by default). FC 042: sign-up, «¿Olvidaste tu contraseña?» and
 * the reset through {@link E2E_RESET_TOKEN}, refusing a new password with the shared policy, as
 * the API does.
 */

/** The code every challenge of the interceptor accepts. */
export const E2E_CODE = '482913';

const CHALLENGE = 'c0000000-0000-4000-8000-000000000001';

export const E2E_ORDER = 'YEK-2026-E2E00001';

/** The only reset link the interceptor accepts (FC 042). */
export const E2E_RESET_TOKEN = 'e'.repeat(64);

/** The 400 of a new password that breaks the policy, or null when it passes. */
function weakPassword(
  route: Route,
  password: unknown,
  context: PasswordContext
) {
  const broken = passwordViolation(String(password), context);
  return broken === null
    ? null
    : problem(route, 400, PASSWORD_PROBLEMS[broken]);
}

/** A small anti-bot challenge (secret number 42) the browser solves for real. */
const SALT = 'e2e0salt?expires=4102444800';
const BOT = {
  algorithm: 'SHA-256',
  challenge: createHash('sha256').update(`${SALT}42`).digest('hex'),
  maxnumber: 1000,
  salt: SALT,
  signature: 'e'.repeat(64),
};

/** Whether a request carries the solution of `BOT`. */
function solved(altcha: unknown): boolean {
  try {
    const solution = JSON.parse(
      Buffer.from(String(altcha), 'base64').toString('utf8')
    ) as { challenge?: string; number?: number };
    return solution.challenge === BOT.challenge && solution.number === 42;
  } catch {
    return false;
  }
}

const SUMMARY = {
  orderNumber: E2E_ORDER,
  status: 'PAID',
  method: 'CARD',
  itemsTotalMxnCents: 485000,
  shippingTotalMxnCents: 15000,
  totalMxnCents: 500000,
  createdAt: '2026-11-01T16:00:00.000Z',
  expiresAt: '2026-11-01T17:00:00.000Z',
  paidAt: '2026-11-01T16:05:00.000Z',
  isTest: true,
};

const DETAIL = {
  ...SUMMARY,
  lines: [
    {
      sku: 'E2E-0001',
      quantity: 1,
      unitPriceMxnCents: 485000,
      lineTotalMxnCents: 485000,
    },
  ],
  paymentEvents: [
    {
      processor: 'STRIPE',
      eventType: 'checkout.session.completed',
      processorStatus: 'paid',
      amountMxnCents: 500000,
      resultingStatus: 'PAID',
      isAlert: false,
      receivedAt: '2026-11-01T16:05:00.000Z',
    },
  ],
};

/** Who signs in: a buyer, or staff with the panel. */
type Persona = 'buyer' | 'staff';

const USERS: Record<Persona, object> = {
  buyer: {
    id: 'b0000000-0000-4000-8000-000000000001',
    email: 'ana@example.test',
    fullName: 'Ana E2E',
    roles: ['customer'],
    permissions: ['account:self'],
  },
  staff: {
    id: 'c0000000-0000-4000-8000-000000000002',
    email: 'luis@example.test',
    fullName: 'Luis E2E',
    roles: ['staff_orders'],
    permissions: ['account:self', 'orders:read'],
  },
};

/** CORS of a credentialed request, as the real API answers the site's origin. */
const CORS = {
  'access-control-allow-origin': 'http://localhost:3100',
  'access-control-allow-credentials': 'true',
};

const json = (route: Route, status: number, body?: unknown) =>
  route.fulfill({
    status,
    contentType: status < 400 ? 'application/json' : 'application/problem+json',
    headers: CORS,
    body: body === undefined ? '' : JSON.stringify(body),
  });

/**
 * Answers the CORS preflight of a JSON POST (WebKit sends it through the interception;
 * Chromium does not), then hands every other request to `answer`.
 */
const withCors = (answer: (route: Route) => Promise<void>) => (route: Route) =>
  route.request().method() === 'OPTIONS'
    ? route.fulfill({
        status: 204,
        headers: {
          ...CORS,
          'access-control-allow-methods': 'GET, POST, PATCH',
          'access-control-allow-headers': 'content-type',
        },
      })
    : answer(route);

const problem = (route: Route, status: number, detail: string) =>
  json(route, status, { type: 'about:blank', title: detail, status, detail });

/** FC 042: the routes that set a password or ask for a reset link, which keep no state. */
const PASSWORD_ROUTES: Record<
  string,
  (route: Route, body: Record<string, unknown>) => Promise<void>
> = {
  '/v1/auth/register': (route, body) =>
    solved(body.altcha)
      ? (weakPassword(route, body.password, {
          email: String(body.email),
          fullName: String(body.fullName),
        }) ?? json(route, 202, { status: 'accepted' }))
      : problem(route, 400, 'BOT_CHALLENGE_REQUIRED'),
  '/v1/auth/forgot-password': (route, body) =>
    solved(body.altcha)
      ? json(route, 200, { ok: true, message: 'neutral' })
      : problem(route, 400, 'BOT_CHALLENGE_REQUIRED'),
  '/v1/auth/reset-password': (route, body) =>
    body.token === E2E_RESET_TOKEN
      ? (weakPassword(route, body.password, { email: '', fullName: '' }) ??
        json(route, 200, { ok: true }))
      : problem(route, 400, 'RESET_TOKEN_INVALID'),
};

/**
 * Intercepts the account API of a page.
 *
 * @param page - The page under test.
 * @param options - Who is signed in from the start (none by default) and who signs in.
 */
export async function mockAccountApi(
  page: Page,
  options: { signedIn?: Persona; persona?: Persona } = {}
): Promise<void> {
  let user: Persona | null = options.signedIn ?? null;
  let trusted = false;
  const persona = options.persona ?? options.signedIn ?? 'buyer';
  await page.route(
    'https://apiv1.yekora.mx/v1/auth/**',
    withCors(async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/v1/auth/bot-challenge') return json(route, 200, BOT);
      const body = route.request().postDataJSON() as Record<string, unknown>;
      if (path === '/v1/auth/login') {
        if (!solved(body.altcha)) {
          return problem(route, 400, 'BOT_CHALLENGE_REQUIRED');
        }
        if (trusted) {
          user = persona;
          return json(route, 201, { status: 'signed_in' });
        }
        return json(route, 200, {
          challengeId: CHALLENGE,
          next: 'verify',
          channel: 'email',
        });
      }
      const password = PASSWORD_ROUTES[path];
      if (password) return password(route, body);
      if (path === '/v1/auth/verify') {
        if (body.code !== E2E_CODE) return problem(route, 401, 'INVALID_CODE');
        user = persona;
        trusted = trusted || body.rememberDevice === true;
        return json(route, 200, { status: 'signed_in' });
      }
      return problem(route, 404, 'NOT_FOUND');
    })
  );
  await page.route(
    'https://apiv1.yekora.mx/v1/account/**',
    withCors((route) =>
      answerAccount(
        route,
        () => user,
        () => (user = null),
        () => (trusted = false)
      )
    )
  );
  await page.route(
    'https://apiv1.yekora.mx/v1/admin/**',
    withCors((route) =>
      user === 'staff'
        ? answerOrders(route)
        : problem(route, 403, 'PERMISSION_DENIED')
    )
  );
}

/** The signed-in routes of the buyer. */
function answerAccount(
  route: Route,
  who: () => Persona | null,
  signOut: () => void,
  forget: () => void
) {
  const user = who();
  if (user === null) return problem(route, 401, 'SESSION_INVALID_OR_EXPIRED');
  const path = new URL(route.request().url()).pathname;
  if (path === '/v1/account/me') return json(route, 200, USERS[user]);
  if (path === '/v1/account/logout') {
    signOut();
    return json(route, 204);
  }
  if (path === '/v1/account/forget-device') {
    forget();
    return json(route, 204);
  }
  return answerOrders(route);
}

/** A list of one order, or that order. */
function answerOrders(route: Route) {
  const path = new URL(route.request().url()).pathname;
  return path.endsWith('/orders')
    ? json(route, 200, { items: [SUMMARY], page: 1, pageSize: 20, total: 1 })
    : json(route, 200, DETAIL);
}
