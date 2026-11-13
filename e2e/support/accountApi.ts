import { createHash, randomUUID } from 'node:crypto';
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
 * the API does. Enmienda 2: `reset-password/check` names the account of that link.
 * FC 044 F2: the owner persona gets `/v1/admin/admins`, which keeps its accounts in memory, never
 * changes the owner's and answers everyone else 403, as the API does.
 * FC 029 F3d: {@link mockCatalogApi} stands in for the catalog backoffice and records every image
 * the browser uploads, with the size it really has.
 */

/** The code every challenge of the interceptor accepts. */
export const E2E_CODE = '482913';

const CHALLENGE = 'c0000000-0000-4000-8000-000000000001';

export const E2E_ORDER = 'YEK-2026-E2E00001';

/** The only reset link the interceptor accepts (FC 042). */
export const E2E_RESET_TOKEN = 'e'.repeat(64);

/** The account {@link E2E_RESET_TOKEN} resets, as `reset-password/check` names it (Enmienda 2). */
const RESET_ACCOUNT = { email: 'ana@example.test', fullName: 'Ana E2E' };

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

/** Who signs in: a buyer, staff with the panel, or the owner. */
type Persona = 'buyer' | 'staff' | 'owner';

const OWNER_ID = 'd0000000-0000-4000-8000-000000000003';

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
  owner: {
    id: OWNER_ID,
    email: 'owner@example.test',
    fullName: 'GrayMan',
    roles: ['owner'],
    permissions: [
      'account:self',
      'audit:read',
      'catalog:write',
      'orders:read',
      'users:manage',
    ],
  },
};

/** An account of the administrators console (FC 044). */
interface AdminAccount {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
  isActive: boolean;
  totpEnabled: boolean;
  createdAt: string;
}

/** The accounts `/v1/admin/admins` starts with: the owner and one administrator. */
const adminAccounts = (): AdminAccount[] => [
  {
    id: OWNER_ID,
    email: 'owner@example.test',
    fullName: 'GrayMan',
    roles: ['owner'],
    isActive: true,
    totpEnabled: true,
    createdAt: '2026-11-11T18:00:00.000Z',
  },
  {
    id: 'd0000000-0000-4000-8000-000000000004',
    email: 'zoe@example.test',
    fullName: 'Zoe E2E',
    roles: ['admin', 'customer'],
    isActive: true,
    totpEnabled: true,
    createdAt: '2026-11-11T18:05:00.000Z',
  },
];

/**
 * `/v1/admin/admins` for the owner (FC 044 T1.2, T1.3): writes need an Idempotency-Key, the
 * owner's account is immutable, and a withdrawn administrator leaves the list.
 */
function answerAdmins(route: Route, accounts: AdminAccount[]) {
  const request = route.request();
  const method = request.method();
  if (method === 'GET') return json(route, 200, { items: accounts });
  if (!request.headers()['idempotency-key']) {
    return problem(route, 400, 'IDEMP_KEY_MISSING');
  }
  const body = request.postDataJSON() as Record<string, unknown>;
  if (method === 'POST') {
    const email = String(body.email).trim().toLowerCase();
    const taken = accounts.find((account) => account.email === email);
    if (taken) {
      return taken.id === OWNER_ID
        ? problem(route, 403, 'OWNER_IMMUTABLE')
        : problem(route, 409, 'ADMIN_ALREADY_EXISTS');
    }
    const created: AdminAccount = {
      id: `d0000000-0000-4000-8000-0000000000${accounts.length + 10}`,
      email,
      fullName: String(body.fullName),
      roles: ['admin', 'customer'],
      isActive: true,
      totpEnabled: false,
      createdAt: '2026-11-11T19:00:00.000Z',
    };
    accounts.push(created);
    return json(route, 201, created);
  }
  const id = new URL(request.url()).pathname.split('/').pop();
  if (id === OWNER_ID) return problem(route, 403, 'OWNER_IMMUTABLE');
  const account = accounts.find((candidate) => candidate.id === id);
  if (!account) return problem(route, 404, 'ADMIN_NOT_FOUND');
  if (typeof body.isActive === 'boolean') account.isActive = body.isActive;
  if (body.revokeAdmin === true) {
    account.roles = ['customer'];
    accounts.splice(accounts.indexOf(account), 1);
  }
  return json(route, 200, account);
}

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
          'access-control-allow-headers': 'content-type, idempotency-key',
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
  '/v1/auth/reset-password/check': (route, body) =>
    body.token === E2E_RESET_TOKEN
      ? json(route, 200, RESET_ACCOUNT)
      : problem(route, 400, 'RESET_TOKEN_INVALID'),
  '/v1/auth/reset-password': (route, body) =>
    body.token === E2E_RESET_TOKEN
      ? (weakPassword(route, body.password, RESET_ACCOUNT) ??
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
  const admins = adminAccounts();
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
    withCors((route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith('/v1/admin/admins')) {
        return user === 'owner'
          ? answerAdmins(route, admins)
          : problem(route, 403, 'OWNER_ROLE_REQUIRED');
      }
      return user === 'staff' || user === 'owner'
        ? answerOrders(route)
        : problem(route, 403, 'PERMISSION_DENIED');
    })
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

/** An upload the page sent to the catalog backoffice, as the browser decoded it. */
export interface Upload {
  /** The Content-Type of the request: what the Canvas encoded. */
  type: string;
  /** Size of the encoded image in pixels. */
  width: number;
  height: number;
}

/** The one product of the interceptor's catalog. */
const CATALOG_PRODUCT = {
  id: 7,
  sku: 'E2E-TRAIL',
  slug: 'e2e-tenis-trail',
  nameEs: 'Tenis trail E2E',
  nameEn: 'Trail shoes E2E',
  descriptionEs: '',
  descriptionEn: '',
  priceMxnCents: 485000,
  stock: 10,
  reservedStock: 0,
  discipline: 'trail-running',
  level: 'intermedio',
  brandId: null,
  shippingClass: 'estandar',
  weightGrams: 800,
  lengthMm: 300,
  widthMm: 200,
  heightMm: 120,
  isActive: true,
  isTest: true,
  facetValueIds: [] as number[],
  gallery: [] as object[],
};

/**
 * Intercepts the catalog backoffice (FC 029 F3d): the product list, the image upload and the
 * gallery of a product. Playwright's WebKit cannot read a Blob body from a request, so the
 * uploads are recorded inside the page instead: a wrapper of `fetch` decodes each image sent to
 * the media route and keeps its type and size. The interceptor judges the type as the API does
 * and answers without decoding.
 *
 * @param page - The page under test.
 * @returns A function that reads the uploads the page has sent so far, in order.
 */
export async function mockCatalogApi(
  page: Page
): Promise<() => Promise<Upload[]>> {
  await page.addInitScript(() => {
    const store: Upload[] = [];
    (globalThis as { __uploads?: Upload[] }).__uploads = store;
    const original = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (
        url.endsWith('/v1/admin/catalog/media') &&
        init?.body instanceof Blob
      ) {
        const bitmap = await createImageBitmap(init.body);
        store.push({
          type: init.body.type,
          width: bitmap.width,
          height: bitmap.height,
        });
      }
      return original(input, init);
    };
  });
  const product = { ...CATALOG_PRODUCT };
  await page.route(
    'https://apiv1.yekora.mx/v1/admin/catalog/**',
    withCors(async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path.endsWith('/products') && request.method() === 'GET') {
        return json(route, 200, {
          items: [product],
          total: 1,
          page: 1,
          pageSize: 50,
        });
      }
      if (path.endsWith('/catalog/media')) {
        const type = String(request.headers()['content-type']);
        if (!/^image\/(webp|jpeg)$/.test(type))
          return problem(route, 415, 'MEDIA_UNSAFE_TYPE');
        return json(route, 201, {
          code: 'MEDIA_ACCEPTED',
          created: true,
          sha256: createHash('sha256').update(randomUUID()).digest('hex'),
          mimeType: type,
          width: 1200,
          height: 1200,
          sizeBytes: 1,
        });
      }
      if (path.endsWith('/media')) {
        const body = request.postDataJSON() as { images: object[] };
        product.gallery = body.images.map((image, sortOrder) => ({
          ...image,
          sortOrder,
          isPrimary: sortOrder === 0,
        }));
        return json(route, 200, product);
      }
      return problem(route, 404, 'CAT_NOT_FOUND');
    })
  );
  return () =>
    page.evaluate(
      () => (globalThis as { __uploads?: Upload[] }).__uploads ?? []
    );
}

/**
 * Puts the sidebar of the account area within reach (FC 046 T2.3): on a phone it opens the drawer
 * with «Menú de la cuenta»; on a wide screen it opens the folded sidebar so the names are on view.
 *
 * @param page - The page showing the signed-in area.
 */
export async function openAccountSidebar(page: Page): Promise<void> {
  const menu = page.getByRole('button', {
    name: /^(Menú de la cuenta|Account menu)$/,
  });
  const sidebar = page.getByRole('complementary', {
    name: /^(Barra lateral de tu cuenta|Sidebar of your account)$/,
  });
  const unfold = page.getByRole('button', {
    name: /^(Desplegar la barra lateral|Expand the sidebar)$/,
  });
  // The area hydrates and loads the session first: wait for whichever control shows up.
  await menu.or(sidebar).or(unfold).first().waitFor();
  if (await sidebar.isVisible()) {
    if (await unfold.isVisible()) await unfold.click();
    return;
  }
  await menu.click();
}
