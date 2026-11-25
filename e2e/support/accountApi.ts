import { createHash, randomUUID } from 'node:crypto';
import type { Page, Route } from '@playwright/test';
import {
  PASSWORD_PROBLEMS,
  type PasswordContext,
  passwordViolation,
} from '../../lib/account/passwordPolicy';
import type { ReturnView } from '../../lib/account/returnTypes';

/**
 * The account API as the E2E suites see it (FC 028 F2): `/v1/auth/*` and `/v1/account/*`,
 * `/v1/admin/*` intercepted in the browser, with a session that only opens after the right code,
 * so no test ever reaches production. Sign-in asks for a solved anti-bot challenge and honours a
 * remembered device (FC 028 Enmienda 1, E1 and E2), as the real API does. Shared by account.spec.ts, a11y.spec.ts and
 * responsive.spec.ts (signed out by default). FC 042: sign-up, «¿Olvidaste tu contraseña?» and
 * the reset through {@link E2E_RESET_TOKEN}, refusing a new password with the shared policy, as
 * the API does. Enmienda 2: `reset-password/check` names the account of that link.
 * FC 072 F2: the owner persona gets `/v1/admin/users` and `/v1/admin/roles`, which keeps its accounts in memory, never
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
  // FC 068: an order that has not shipped has no parcel.
  fulfillment: null,
  carrier: null,
  trackingNumber: null,
  trackingUrl: null,
  shippedAt: null,
  deliveredAt: null,
  lines: [
    {
      sku: 'E2E-0001',
      quantity: 1,
      unitPriceMxnCents: 485000,
      lineTotalMxnCents: 485000,
      // FC 073: the line sold with the right to return it, and no unit asked yet.
      allowsReturn: true,
      returnedQuantity: 0,
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
      'orders:manage',
      'shipping:manage',
      'users:manage',
      'sellers:manage',
      'roles:manage',
      'returns:view',
      'returns:prepare',
      'returns:confirm',
    ],
  },
};

/** An account of the staff panel (FC 044, FC 072). */
interface StaffAccount {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
  isActive: boolean;
  totpEnabled: boolean;
  createdAt: string;
}

/** The accounts `/v1/admin/users` starts with: the owner and one administrator. */
const staffAccounts = (): StaffAccount[] => [
  {
    id: OWNER_ID,
    email: 'owner@example.test',
    fullName: 'GrayMan',
    roles: ['customer', 'owner'],
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

/** A role of the panel with its permissions (FC 072). */
interface StaffRole {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  isSystem: boolean;
  assignableByAdmin: boolean;
  permissions: string[];
}

/** The permissions the matrix is made of, as the API names them. */
const STAFF_CATALOG = [
  'account:self',
  'orders:manage',
  'orders:read',
  'returns:view',
  'roles:manage',
  'sellers:manage',
  'users:manage',
];

/** The roles `/v1/admin/roles` starts with: the owner's, the administrator's and the two of the staff. */
const staffRoles = (): StaffRole[] =>
  [
    ['owner', 'Dueño', true, false, STAFF_CATALOG],
    ['customer', 'Cliente', true, false, ['account:self']],
    [
      'admin',
      'Administrador',
      false,
      false,
      ['account:self', 'orders:read', 'users:manage'],
    ],
    [
      'staff_orders',
      'Vendedor',
      false,
      true,
      ['account:self', 'orders:manage', 'orders:read'],
    ],
    ['staff_catalog', 'Staff · Catálogo', false, true, ['account:self']],
  ].map(([id, name, isSystem, assignableByAdmin, permissions]) => ({
    id: id as string,
    name: name as string,
    description: null,
    isActive: true,
    isSystem: isSystem as boolean,
    assignableByAdmin: assignableByAdmin as boolean,
    permissions: permissions as string[],
  }));

/**
 * `/v1/admin/roles` for the owner (FC 072 T1.2): the roles with the catalog of the matrix, a role
 * of support that is created, and the changes of a role and its permissions. Writes need an
 * Idempotency-Key and a role of the system is protected.
 */
function answerRoles(route: Route, roles: StaffRole[]) {
  const request = route.request();
  const method = request.method();
  if (method === 'GET') {
    return json(route, 200, { items: roles, catalog: STAFF_CATALOG });
  }
  if (!request.headers()['idempotency-key']) {
    return problem(route, 400, 'IDEMP_KEY_MISSING');
  }
  const body = request.postDataJSON() as Record<string, unknown>;
  if (method === 'POST') {
    if (roles.some((candidate) => candidate.id === body.id)) {
      return problem(route, 409, 'ROLE_ALREADY_EXISTS');
    }
    const created: StaffRole = {
      id: String(body.id),
      name: String(body.name),
      description:
        typeof body.description === 'string' ? body.description : null,
      isActive: true,
      isSystem: false,
      assignableByAdmin: body.assignableByAdmin !== false,
      permissions: [...(body.permissions as string[])].sort(),
    };
    roles.push(created);
    return json(route, 201, created);
  }
  const id = new URL(request.url()).pathname.split('/').pop();
  const role = roles.find((candidate) => candidate.id === id);
  if (!role) return problem(route, 404, 'ROLE_NOT_FOUND');
  if (role.isSystem) return problem(route, 403, 'SYSTEM_ROLE_PROTECTED');
  if (Array.isArray(body.permissions)) {
    role.permissions = [...(body.permissions as string[])].sort();
  }
  if (typeof body.isActive === 'boolean') role.isActive = body.isActive;
  if (typeof body.assignableByAdmin === 'boolean') {
    role.assignableByAdmin = body.assignableByAdmin;
  }
  return json(route, 200, role);
}

/**
 * `/v1/admin/users` for the owner (FC 072 T1.1, T2.1): writes need an Idempotency-Key, the
 * owner's account is immutable, a person already in the staff is a conflict and the roles that
 * come with a write replace the ones an account held.
 */
function answerStaff(route: Route, accounts: StaffAccount[]) {
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
        : problem(route, 409, 'STAFF_ALREADY_EXISTS');
    }
    const created: StaffAccount = {
      id: `d0000000-0000-4000-8000-0000000000${accounts.length + 10}`,
      email,
      fullName: String(body.fullName),
      roles: ['customer', ...(body.roles as string[])].sort(),
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
  if (!account) return problem(route, 404, 'USER_NOT_FOUND');
  if (typeof body.isActive === 'boolean') account.isActive = body.isActive;
  if (Array.isArray(body.roles)) {
    account.roles = ['customer', ...(body.roles as string[])].sort();
  }
  return json(route, 200, account);
}

/** One state of the shipping console (FC 061) with its rate in cents. */
interface ShippingState {
  id: number;
  code: string;
  name: string;
  nameEn: string;
  cents: number;
}

/** Three states are enough to prove the console edits each one on its own. */
const SHIPPING_STATES: readonly ShippingState[] = [
  {
    id: 1,
    code: 'AGU',
    name: 'Aguascalientes',
    nameEn: 'Aguascalientes',
    cents: 15000,
  },
  {
    id: 7,
    code: 'CMX',
    name: 'Ciudad de México',
    nameEn: 'Mexico City',
    cents: 15000,
  },
  {
    id: 32,
    code: 'ZAC',
    name: 'Zacatecas',
    nameEn: 'Zacatecas',
    cents: 15000,
  },
];

/** The shipping console view as `GET /v1/admin/shipping` answers it. */
function shippingView(
  states: ShippingState[],
  config: { free: boolean; threshold: number | null }
) {
  return {
    config: {
      strategyId: 2,
      isFreeShippingActive: config.free,
      freeShippingThresholdMxnCents: config.threshold,
    },
    strategies: [
      {
        id: 2,
        code: 'ZONE_RATE',
        nameEs: 'Tarifa por estado',
        nameEn: 'Rate by state',
        administrable: true,
      },
    ],
    classes: [],
    zones: states.map(({ id, code, name, nameEn }) => ({
      id,
      code,
      nameEs: name,
      nameEn,
    })),
    rules: states.map(({ id, cents }) => ({ zoneId: id, rateMxnCents: cents })),
  };
}

/**
 * `/v1/admin/shipping` for the owner (FC 061 T1.1, T1.2): the rates and free shipping live in
 * memory, writes need an Idempotency-Key, and the answer is the view after the change.
 */
function answerShipping(
  route: Route,
  states: ShippingState[],
  config: { free: boolean; threshold: number | null }
) {
  const request = route.request();
  if (request.method() === 'GET') {
    return json(route, 200, shippingView(states, config));
  }
  if (!request.headers()['idempotency-key']) {
    return problem(route, 400, 'IDEMP_KEY_MISSING');
  }
  const body = request.postDataJSON() as Record<string, unknown>;
  if (new URL(request.url()).pathname.endsWith('/rules')) {
    for (const rule of body.rules as {
      zoneId: number;
      rateMxnCents: number;
    }[]) {
      const state = states.find((candidate) => candidate.id === rule.zoneId);
      if (state) state.cents = rule.rateMxnCents;
    }
  } else {
    config.free = body.isFreeShippingActive === true;
    config.threshold = (body.freeShippingThresholdMxnCents as number) ?? null;
  }
  return json(route, 200, shippingView(states, config));
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
          'access-control-allow-methods': 'GET, POST, PUT, PATCH',
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

/** One address of the buyer's book, as the API answers it (FC 051). */
export interface E2eAddress {
  id: string;
  isDefault: boolean;
  isComplete: boolean;
  stateCode: string;
  postalCode: string;
  label: string | null;
  name: string | null;
  phone: string | null;
  street: string | null;
  exteriorNumber: string | null;
  interiorNumber: string | null;
  neighborhood: string | null;
  municipality: string | null;
  references: string | null;
}

/** An address of Ana in Zacatecas, whole, for a test to start with. */
export const E2E_HOME: E2eAddress = {
  id: 'a0000000-0000-4000-8000-000000000001',
  isDefault: true,
  isComplete: true,
  stateCode: 'ZAC',
  postalCode: '98612',
  label: 'Casa',
  name: 'Ana E2E',
  phone: '4929421780',
  street: 'Av. Barones',
  exteriorNumber: '209',
  interiorNumber: null,
  neighborhood: 'Las Américas',
  municipality: 'Guadalupe',
  references: null,
};

/** The eight codes the authenticator's enrolment shows once (FC 056). */
export const E2E_BACKUP_CODES = [
  '10000001',
  '10000002',
  '10000003',
  '10000004',
  '10000005',
  '10000006',
  '10000007',
  '10000008',
];

/** One saved card as the API shows it: brand, last four digits and expiry, nothing else (FC 054). */
export interface E2eCard {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

/** A Visa of Ana, for a test to start with. */
export const E2E_VISA: E2eCard = {
  id: 'pm_1E2eVisa000001',
  brand: 'visa',
  last4: '4242',
  expMonth: 3,
  expYear: 2031,
};

/** The card a person types on Stripe's page in the emulated «add a card» (FC 057). */
export const E2E_NEW_CARD: E2eCard = {
  id: 'pm_1E2eMaster0002',
  brand: 'mastercard',
  last4: '5100',
  expMonth: 11,
  expYear: 2032,
};

/** Where the emulated «add a card» sends the browser: Stripe's own host, which a test intercepts. */
export const E2E_CARD_SETUP_PAGE =
  'https://checkout.stripe.com/c/setup/cs_test_e2e';

/** The profile, the book of addresses and the saved cards the interceptor keeps for the buyer. */
interface AccountData {
  fullName: string | null;
  phone: string | null;
  addresses: E2eAddress[];
  cards: E2eCard[];
  next: number;
}

/** The place of the default address, as `GET /v1/account/me` hands it back. */
function deliveryOf(data: AccountData) {
  const chosen = data.addresses.find((address) => address.isDefault);
  return {
    phone: data.phone,
    postalCode: chosen?.postalCode ?? null,
    stateCode: chosen?.stateCode ?? null,
  };
}

/** Keeps exactly one default address: the given one, or the first left. */
function settleDefault(data: AccountData, id: string | null) {
  const chosen =
    data.addresses.find((address) => address.id === id) ?? data.addresses[0];
  for (const address of data.addresses) {
    address.isDefault = address === chosen;
  }
}

/** Answers `/v1/account/profile` and `/v1/account/addresses` from the buyer's own data. */
function answerData(route: Route, data: AccountData) {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  const method = request.method();
  const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
  if (path === '/v1/account/profile') {
    data.fullName = String(body.fullName);
    data.phone = String(body.phone);
    return json(route, 200, { fullName: data.fullName });
  }
  if (method === 'GET') {
    return json(route, 200, { items: data.addresses, max: 5 });
  }
  if (method === 'POST') {
    if (data.addresses.length >= 5) {
      return problem(route, 409, 'ADDRESS_LIMIT_REACHED');
    }
    data.next += 1;
    const created = {
      id: `a0000000-0000-4000-8000-${String(data.next).padStart(12, '0')}`,
      isDefault: false,
      isComplete: true,
      label: null,
      interiorNumber: null,
      references: null,
      ...body,
    } as E2eAddress;
    data.addresses.push(created);
    settleDefault(
      data,
      body.isDefault === true || data.addresses.length === 1
        ? created.id
        : (data.addresses.find((address) => address.isDefault)?.id ?? null)
    );
    return json(route, 201, {
      id: created.id,
      isDefault: created.isDefault,
      isComplete: true,
    });
  }
  const id = path.split('/').pop() as string;
  const found = data.addresses.find((address) => address.id === id);
  if (!found) return problem(route, 404, 'ADDRESS_NOT_FOUND');
  if (method === 'DELETE') {
    data.addresses = data.addresses.filter((address) => address !== found);
    settleDefault(data, null);
    return json(route, 204);
  }
  const { isDefault, ...changes } = body;
  if (Object.keys(changes).length > 0) {
    Object.assign(found, changes, { isComplete: true });
  }
  settleDefault(
    data,
    isDefault === true
      ? id
      : (data.addresses.find((address) => address.isDefault)?.id ?? null)
  );
  return json(route, 200, {
    id,
    isDefault: found.isDefault,
    isComplete: found.isComplete,
  });
}

/**
 * The authenticator's enrolment (FC 056): its secret, and the first code that turns it on, which
 * signs in and shows the backup codes once.
 *
 * @returns The answer, or null when the path is not one of the enrolment's.
 */
function answerEnrolment(
  route: Route,
  path: string,
  body: Record<string, unknown>,
  confirmed: () => void
) {
  if (path === '/v1/auth/totp/enroll') {
    return json(route, 200, {
      secret: 'JBSWY3DPEHPK3PXP',
      otpauthUri: 'otpauth://totp/Yekora:luis?secret=JBSWY3DPEHPK3PXP',
    });
  }
  if (path !== '/v1/auth/totp/confirm') return null;
  if (body.code !== E2E_CODE) return problem(route, 401, 'INVALID_CODE');
  confirmed();
  return json(route, 200, { backupCodes: E2E_BACKUP_CODES });
}

/**
 * Intercepts the account API of a page.
 *
 * @param page - The page under test.
 * @param options - Who is signed in from the start (none by default), who signs in, and the
 *   addresses and phone the buyer starts with (FC 051).
 */
export async function mockAccountApi(
  page: Page,
  options: {
    signedIn?: Persona;
    persona?: Persona;
    addresses?: E2eAddress[];
    /** The cards the buyer has saved at Stripe from the start (FC 054). */
    cards?: E2eCard[];
    phone?: string | null;
    /** How long the signed-in routes take to answer, as a sleeping API does (FC 053). */
    latencyMs?: number;
    /** The account has not turned its authenticator on yet: signing in goes through enrolment (FC 056). */
    enrollment?: boolean;
    /** The order is already delivered, two days ago, so the buyer may ask for a return (FC 073). */
    delivered?: boolean;
    /** The board of returns starts with a request to prepare and one prepared by someone else (FC 073). */
    seedReturns?: boolean;
  } = {}
): Promise<void> {
  let user: Persona | null = options.signedIn ?? null;
  let trusted = false;
  let enrolled = !options.enrollment;
  const data: AccountData = {
    fullName: null,
    phone: options.phone ?? null,
    addresses: structuredClone(options.addresses ?? []),
    cards: structuredClone(options.cards ?? []),
    next: 10,
  };
  const persona = options.persona ?? options.signedIn ?? 'buyer';
  const staffRows = staffAccounts();
  const roleRows = staffRoles();
  const fulfillment = newFulfillment(options.delivered ? 'DELIVERED' : null);
  const returns = newReturns(options.seedReturns === true);
  const shippingStates = SHIPPING_STATES.map((state) => ({ ...state }));
  const shippingConfig: { free: boolean; threshold: number | null } = {
    free: false,
    threshold: null,
  };
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
        if (!enrolled) return problem(route, 403, 'TOTP_NOT_ENROLLED');
        user = persona;
        trusted = trusted || body.rememberDevice === true;
        return json(route, 200, { status: 'signed_in' });
      }
      const enrolment = answerEnrolment(route, path, body, () => {
        enrolled = true;
        user = persona;
      });
      if (enrolment) return enrolment;
      return problem(route, 404, 'NOT_FOUND');
    })
  );
  await page.route(
    'https://apiv1.yekora.mx/v1/account/**',
    withCors(async (route) => {
      if (options.latencyMs) {
        await new Promise((resolve) => setTimeout(resolve, options.latencyMs));
      }
      return answerAccount(
        route,
        () => user,
        () => (user = null),
        () => (trusted = false),
        data,
        { fulfillment, returns }
      );
    })
  );
  await page.route(
    'https://apiv1.yekora.mx/v1/admin/**',
    withCors((route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith('/v1/admin/users')) {
        return user === 'owner'
          ? answerStaff(route, staffRows)
          : problem(route, 403, 'PERMISSION_DENIED');
      }
      if (path.startsWith('/v1/admin/roles')) {
        return user === 'owner'
          ? answerRoles(route, roleRows)
          : problem(route, 403, 'PERMISSION_DENIED');
      }
      if (path.startsWith('/v1/admin/shipping')) {
        return user === 'owner'
          ? answerShipping(route, shippingStates, shippingConfig)
          : problem(route, 403, 'PERMISSION_DENIED');
      }
      if (path.startsWith('/v1/admin/returns')) {
        return user === 'owner'
          ? answerReturns(route, returns, user)
          : problem(route, 403, 'PERMISSION_DENIED');
      }
      // FC 068: staff who only read orders may not operate them.
      if (/\/(prepare|ship|deliver)$/.test(path) && user !== 'owner') {
        return problem(route, 403, 'PERMISSION_DENIED');
      }
      return user === 'staff' || user === 'owner'
        ? answerOrders(route, fulfillment, returns)
        : problem(route, 403, 'PERMISSION_DENIED');
    })
  );
}

/** The signed-in routes of the buyer. */
function answerAccount(
  route: Route,
  who: () => Persona | null,
  signOut: () => void,
  forget: () => void,
  data: AccountData,
  world: { fulfillment: Fulfillment; returns: Returns }
) {
  const user = who();
  if (user === null) return problem(route, 401, 'SESSION_INVALID_OR_EXPIRED');
  const path = new URL(route.request().url()).pathname;
  if (path === '/v1/account/me') {
    return json(route, 200, {
      ...USERS[user],
      fullName: data.fullName ?? (USERS[user] as { fullName: string }).fullName,
      ...deliveryOf(data),
    });
  }
  if (
    path === '/v1/account/profile' ||
    path.startsWith('/v1/account/addresses')
  ) {
    return answerData(route, data);
  }
  if (path.startsWith('/v1/account/payment-methods')) {
    return answerCards(route, data);
  }
  if (path === '/v1/account/logout') {
    signOut();
    return json(route, 204);
  }
  if (path === '/v1/account/forget-device') {
    forget();
    return json(route, 204);
  }
  if (/^\/v1\/account\/orders\/[^/]+\/returns$/.test(path)) {
    return answerReturnRequest(route, world.fulfillment, world.returns);
  }
  return answerOrders(route, world.fulfillment, world.returns);
}

/**
 * Answers `/v1/account/payment-methods`: list (the newest first), open Stripe's page to add one
 * (where the person «types» a new card, so it is already at Stripe when they come back), settle the
 * account to its newest card, and detach one (FC 054, FC 057).
 */
function answerCards(route: Route, data: AccountData) {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  if (request.method() === 'GET') {
    return json(route, 200, {
      items: [...data.cards].reverse(),
      hasCustomer: data.cards.length > 0,
    });
  }
  if (path.endsWith('/setup')) {
    data.cards.push({
      ...E2E_NEW_CARD,
      id: `pm_1E2eAdded${data.cards.length}`,
    });
    return json(route, 201, { redirectUrl: E2E_CARD_SETUP_PAGE });
  }
  if (path.endsWith('/settle')) {
    const newest = data.cards.at(-1);
    if (newest === undefined) return problem(route, 400, 'CARD_ATTACH_FAILED');
    const replaced = data.cards.length > 1;
    data.cards = [newest];
    return json(route, 200, {
      status: replaced ? 'replaced' : 'saved',
      paymentMethod: newest,
    });
  }
  const id = path.split('/').pop();
  const found = data.cards.some((card) => card.id === id);
  if (!found) return problem(route, 404, 'PAYMENT_METHOD_NOT_FOUND');
  data.cards = data.cards.filter((card) => card.id !== id);
  return json(route, 200, { detached: true });
}

/** A list of one order, or that order. */
function answerOrders(
  route: Route,
  parcel: Fulfillment = newFulfillment(),
  returns?: Returns
) {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  if (path.endsWith('/orders')) {
    return json(route, 200, {
      items: [{ ...SUMMARY, fulfillment: parcel.step }],
      page: 1,
      pageSize: 20,
      total: 1,
    });
  }
  const step = /\/(prepare|ship|deliver)$/.exec(path)?.[1];
  if (step === undefined) {
    return json(route, 200, {
      ...DETAIL,
      lines: DETAIL.lines.map((line) => ({
        ...line,
        returnedQuantity: returns?.asked ?? 0,
      })),
      ...parcel.view(),
    });
  }
  // FC 068: the three steps, in the order the API admits them.
  if (!request.headers()['idempotency-key']) {
    return problem(route, 400, 'IDEMP_KEY_MISSING');
  }
  const admitted: Record<string, (string | null)[]> = {
    prepare: [null],
    ship: [null, 'PREPARING'],
    deliver: ['SHIPPED'],
  };
  if (!admitted[step].includes(parcel.step)) {
    return problem(route, 409, 'ORDER_STATUS_CONFLICT');
  }
  if (step === 'ship') {
    const body = request.postDataJSON() as Record<string, string | undefined>;
    parcel.carrier = body.carrier ?? null;
    parcel.trackingNumber = body.trackingNumber ?? null;
    parcel.trackingUrl = body.trackingUrl ?? null;
    parcel.step = 'SHIPPED';
  } else {
    parcel.step = step === 'prepare' ? 'PREPARING' : 'DELIVERED';
  }
  return json(route, 200, { orderNumber: E2E_ORDER, ...parcel.view() });
}

/** The fulfillment of the one order of the interceptor, kept while a test runs (FC 068). */
interface Fulfillment {
  step: 'PREPARING' | 'SHIPPED' | 'DELIVERED' | null;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  /** The fields an order answer carries for the current step. */
  view: () => {
    fulfillment: Fulfillment['step'];
    carrier: string | null;
    trackingNumber: string | null;
    trackingUrl: string | null;
    shippedAt: string | null;
    deliveredAt: string | null;
  };
}

/** A fresh fulfillment: nothing has happened to the order. */
function newFulfillment(initial: Fulfillment['step'] = null): Fulfillment {
  const parcel: Fulfillment = {
    step: initial,
    carrier: null,
    trackingNumber: null,
    trackingUrl: null,
    view: () => ({
      fulfillment: parcel.step,
      carrier: parcel.carrier,
      trackingNumber: parcel.trackingNumber,
      trackingUrl: parcel.trackingUrl,
      shippedAt:
        parcel.step === 'SHIPPED' || parcel.step === 'DELIVERED'
          ? '2026-11-02T09:00:00.000Z'
          : null,
      // Two days ago, so the window of 60 days is open whenever the suite runs (FC 073).
      deliveredAt:
        parcel.step === 'DELIVERED'
          ? new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
          : null,
    }),
  };
  return parcel;
}

/** The returns of the interceptor, kept while a test runs (FC 073): the board's rows and the units the buyer asked. */
interface Returns {
  rows: ReturnView[];
  /** Who prepared each request, by id: the board refuses the same person confirming it (T2.1). */
  preparedBy: Map<number, Persona | 'other'>;
  /** Units of the one line of the order already asked in any request. */
  asked: number;
}

const RETURN_BASE: ReturnView = {
  id: 1,
  orderNumber: E2E_ORDER,
  status: 'REQUESTED',
  reason: 'DEFECT',
  comment: null,
  items: [{ sku: 'E2E-0001', quantity: 1 }],
  refundMxnCents: null,
  restock: null,
  createdAt: '2026-11-20T16:00:00.000Z',
  preparedAt: null,
  confirmedAt: null,
};

/** Fresh returns: none, or a request to prepare and one prepared by someone else. */
function newReturns(seed: boolean): Returns {
  const returns: Returns = { rows: [], preparedBy: new Map(), asked: 0 };
  if (seed) {
    returns.rows.push(
      { ...RETURN_BASE, id: 1, comment: 'Llegó roto' },
      {
        ...RETURN_BASE,
        id: 2,
        orderNumber: 'YEK-2026-E2E00002',
        reason: 'CHANGED_MIND',
        status: 'PREPARED',
        refundMxnCents: 485000,
        restock: true,
        preparedAt: '2026-11-21T16:00:00.000Z',
      }
    );
    returns.preparedBy.set(2, 'other');
  }
  return returns;
}

/**
 * Answers the board `/v1/admin/returns` (FC 073): the list, the preparation and the confirmation
 * in the stages the API admits them, and the refusal of the same person confirming what they
 * prepared (T2.1).
 */
function answerReturns(route: Route, returns: Returns, who: Persona) {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  if (request.method() === 'GET') {
    const status = new URL(request.url()).searchParams.get('status');
    const items = returns.rows.filter(
      (row) => status === null || row.status === status
    );
    return json(route, 200, { items, total: items.length });
  }
  const step = /\/returns\/(\d+)\/(prepare|confirm)$/.exec(path);
  const row = returns.rows.find((entry) => entry.id === Number(step?.[1]));
  if (step === null || row === undefined) {
    return problem(route, 404, 'RETURN_NOT_FOUND');
  }
  if (step[2] === 'prepare') {
    if (!request.headers()['idempotency-key']) {
      return problem(route, 400, 'IDEMP_KEY_MISSING');
    }
    if (row.status !== 'REQUESTED') {
      return problem(route, 409, 'RETURN_STATUS_CONFLICT');
    }
    const body = request.postDataJSON() as {
      refundMxnCents: number;
      restock: boolean;
    };
    if (body.refundMxnCents > DETAIL.totalMxnCents) {
      return problem(route, 409, 'INVALID_REFUND_AMOUNT_REJECT');
    }
    Object.assign(row, {
      status: 'PREPARED',
      refundMxnCents: body.refundMxnCents,
      restock: body.restock,
      preparedAt: new Date().toISOString(),
    });
    returns.preparedBy.set(row.id, who);
    return json(route, 200, row);
  }
  if (row.status === 'REFUNDED') return json(route, 200, row);
  if (row.status === 'REQUESTED') {
    return problem(route, 409, 'RETURN_NOT_PREPARED_REJECT');
  }
  if (returns.preparedBy.get(row.id) === who) {
    return problem(route, 403, 'DUAL_CONTROL_VIOLATION_REJECT');
  }
  Object.assign(row, {
    status: 'REFUNDED',
    confirmedAt: new Date().toISOString(),
  });
  return json(route, 200, row);
}

/**
 * Answers the buyer's `POST /v1/account/orders/:order_number/returns` (FC 073): a key is
 * required, the order must be delivered and the units cannot pass what is left to return.
 */
function answerReturnRequest(
  route: Route,
  parcel: Fulfillment,
  returns: Returns
) {
  const request = route.request();
  if (!request.headers()['idempotency-key']) {
    return problem(route, 400, 'IDEMP_KEY_MISSING');
  }
  if (parcel.step !== 'DELIVERED') {
    return problem(route, 409, 'ORDER_NOT_DELIVERED_REJECT');
  }
  const body = request.postDataJSON() as {
    items: { sku: string; quantity: number }[];
    reason: ReturnView['reason'];
    comment?: string;
  };
  const units = body.items.reduce((sum, line) => sum + line.quantity, 0);
  if (units + returns.asked > DETAIL.lines[0].quantity) {
    return problem(route, 400, 'INVALID_QUANTITY_REJECT');
  }
  returns.asked += units;
  const row: ReturnView = {
    ...RETURN_BASE,
    id: returns.rows.length + 1,
    status: 'REQUESTED',
    reason: body.reason,
    comment: body.comment ?? null,
    items: body.items,
    createdAt: new Date().toISOString(),
  };
  returns.rows.push(row);
  return json(route, 201, row);
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
  brandId: null,
  shippingClass: 'estandar',
  weightGrams: 800,
  lengthMm: 300,
  widthMm: 200,
  heightMm: 120,
  allowsReturn: true,
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
 * Opens the account menu of the header (FC 047 T2.4), where the sections of the account, the
 * language, «Olvidar este dispositivo» and «Salir» live. It is a <details>, so it is opened only
 * when closed: a second click on its summary would fold it again.
 *
 * @param page - Any page of the site.
 */
export async function openAccountMenu(page: Page): Promise<void> {
  const menu = page.getByRole('banner').locator('details');
  if (await menu.evaluate((element) => !(element as HTMLDetailsElement).open)) {
    await menu.locator('summary').click();
  }
}
