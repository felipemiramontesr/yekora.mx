/**
 * The signed-in account (FC 028): `/v1/account/*`, guarded by the permission `account:self`.
 * The guard in app.ts has already found the session, checked the second factor and the
 * permission, and set `request.user` before these handlers run.
 *
 * - `me` answers who is signed in, with the roles and permissions the interface may show
 *   (143_AN B4: the interface only hides; the API decides).
 * - `logout` ends the session and clears the cookie. A trusted device stays remembered.
 * - `forget-device` (Enmienda 1, T2.9d) forgets this browser's trusted device: the row goes and
 *   the cookie expires. Only the signed-in user's own device is touched.
 * - `profile` (FC 051) changes the name and the phone; the e-mail is the account's identifier and
 *   no route changes it. `addresses` is the book of up to five delivery addresses: list, add,
 *   edit or make the default one, delete. Every write needs an `Idempotency-Key` and the personal
 *   data key (else 503); an id of another account answers 404 like one that does not exist; the
 *   answers carry no personal data, since the API keeps them to retry a request.
 * - `orders` lists the buyer's own orders, always filtered by the session's user (T2.6b), and
 *   `orders/:order_number` shows one of them; another account's order, or a guest purchase, is
 *   refused with 403 DATA_DOMAIN_FORBIDDEN (T1.2 D). Read-only (T2.6a, routes/orders.ts).
 *
 * @module
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  addressListSchema,
  addressParams,
  addressPatchRequestSchema,
  addressSavedSchema,
  addressUpsertRequestSchema,
  MAX_USER_ADDRESSES,
  profileUpdatedSchema,
  profileUpdateRequestSchema,
} from '../../../../lib/account/addressTypes';
import { meResponseSchema } from '../../../../lib/account/authTypes';
import {
  accountOrdersQuery,
  orderDetailSchema,
  orderPageSchema,
} from '../../../../lib/account/orderTypes';
import { problem, PROBLEM_TYPE } from '../lib/problem';
import {
  clearedDeviceCookie,
  clearedSessionCookie,
  readDeviceToken,
} from '../lib/session';
import {
  accountDelivery,
  type AddressRefusal,
  createAddress,
  deleteAddress,
  listAddresses,
  updateAddress,
  updateProfile,
} from '../services/accountAddresses';
import { recordAudit } from '../services/audit';
import { expireOverdueOrders } from '../services/checkout';
import type { Db, Transactional } from '../services/db';
import { closeSession, type SessionUser } from '../services/identity';
import { checkIdempotencyKey } from '../services/idempotency';
import { listOrders } from '../services/orderReads';
import { forgetDevice } from '../services/trustedDevices';
import { refuse, runOnce } from './catalogMutation';
import { lookUpOrder } from './orders';

/** Dependencies of the account routes. */
interface AccountDeps {
  /** Database with transactions (lazy expiry of overdue orders). */
  db: Db & Transactional;
  /** Clock. */
  now: () => Date;
  /** CHECKOUT_PII_KEY, or null when the checkout secrets are not configured (FC 047). */
  piiKey: Buffer | null;
}

/** Status and title of each refusal of a write to the book of addresses. */
const ADDRESS_REFUSALS: Readonly<
  Record<AddressRefusal, readonly [number, string]>
> = {
  ADDRESS_NOT_FOUND: [404, 'Not found'],
  ADDRESS_LIMIT_REACHED: [409, 'The account already holds five addresses'],
};

/**
 * The first two checks of every write (FC 051 T1.1–T1.3): a valid `Idempotency-Key`, then the key
 * of the personal data, which the account cannot be written without.
 *
 * @returns The idempotency key and the data key, or null once the refusal has been sent.
 */
function writeGate(
  deps: Pick<AccountDeps, 'piiKey'>,
  request: FastifyRequest,
  reply: FastifyReply
): { key: string; pii: Buffer } | null {
  const key = checkIdempotencyKey(request.headers['idempotency-key']);
  if (key.code !== 'IDEMP_KEY_ACCEPTED') {
    refuse(reply, 400, 'Idempotency-Key required', key.code);
    return null;
  }
  if (deps.piiKey === null) {
    refuse(
      reply,
      503,
      'Personal data cannot be saved right now',
      'SERVICE_UNAVAILABLE'
    );
    return null;
  }
  return { key: key.key, pii: deps.piiKey };
}

/** The answer of a write refused for the book of addresses. */
function refusalOf(refusal: AddressRefusal) {
  const [status, title] = ADDRESS_REFUSALS[refusal];
  return { status, body: problem(status, title, refusal) };
}

/** The audit entry of a write to the book: the address and what happened, never what it says. */
function auditAddress(
  tx: Parameters<typeof recordAudit>[0],
  request: FastifyRequest,
  userId: string,
  action: string,
  saved: { id: string; isDefault?: boolean; isComplete?: boolean }
) {
  return recordAudit(tx, {
    userId,
    action,
    entityType: 'user_addresses',
    entityId: saved.id,
    before: null,
    after: { isDefault: saved.isDefault, isComplete: saved.isComplete },
    ip: request.ip,
  });
}

/**
 * Registers the account routes.
 *
 * @param app - Fastify instance.
 * @param deps - Database and clock.
 */
export function registerAccountRoutes(
  app: FastifyInstance,
  deps: AccountDeps
): void {
  app.get('/v1/account/me', async (request, reply) => {
    const user = request.user as SessionUser;
    // FC 047 T2.3, FC 051: only the holder gets their own phone and the place of their default
    // address back; a value that does not authenticate is logged and left out, so one bad row
    // never closes the account area.
    const delivery = await accountDelivery(
      deps.db,
      deps.piiKey,
      user.userId
    ).catch((error: unknown) => {
      request.log.error({ err: error }, 'account data unreadable');
      return { phone: null, postalCode: null, stateCode: null };
    });
    return reply.send(
      meResponseSchema.parse({
        id: user.userId,
        email: user.email,
        fullName: user.fullName,
        roles: user.roles,
        permissions: user.permissions,
        ...delivery,
      })
    );
  });

  app.patch('/v1/account/profile', async (request, reply) => {
    const gate = writeGate(deps, request, reply);
    if (gate === null) return reply;
    const body = profileUpdateRequestSchema.safeParse(request.body);
    if (!body.success) {
      return refuse(reply, 400, 'Invalid request', 'INVALID_REQUEST');
    }
    return runOnce(deps, request, reply, gate.key, async (tx, userId) => {
      await updateProfile(tx, gate.pii, userId, body.data);
      await recordAudit(tx, {
        userId,
        action: 'ACCOUNT_PROFILE_UPDATED',
        entityType: 'users',
        entityId: userId,
        before: null,
        after: { changed: ['fullName', 'phone'] },
        ip: request.ip,
      });
      return {
        status: 200,
        body: profileUpdatedSchema.parse({ fullName: body.data.fullName }),
      };
    });
  });

  app.get('/v1/account/addresses', async (request, reply) => {
    if (deps.piiKey === null) {
      return refuse(
        reply,
        503,
        'Personal data cannot be read right now',
        'SERVICE_UNAVAILABLE'
      );
    }
    const items = await listAddresses(
      deps.db,
      deps.piiKey,
      (request.user as SessionUser).userId
    );
    return addressListSchema.parse({ items, max: MAX_USER_ADDRESSES });
  });

  app.post('/v1/account/addresses', async (request, reply) => {
    const gate = writeGate(deps, request, reply);
    if (gate === null) return reply;
    const body = addressUpsertRequestSchema.safeParse(request.body);
    if (!body.success) {
      return refuse(reply, 400, 'Invalid address', 'INVALID_ADDRESS');
    }
    const { isDefault, ...address } = body.data;
    return runOnce(deps, request, reply, gate.key, async (tx, userId) => {
      const saved = await createAddress(
        tx,
        gate.pii,
        userId,
        address,
        isDefault === true
      );
      if (typeof saved === 'string') return refusalOf(saved);
      await auditAddress(tx, request, userId, 'ADDRESS_CREATED', saved);
      return { status: 201, body: addressSavedSchema.parse(saved) };
    });
  });

  app.patch('/v1/account/addresses/:id', async (request, reply) => {
    const gate = writeGate(deps, request, reply);
    if (gate === null) return reply;
    const params = addressParams.safeParse(request.params);
    const body = addressPatchRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return refuse(reply, 400, 'Invalid address', 'INVALID_ADDRESS');
    }
    return runOnce(deps, request, reply, gate.key, async (tx, userId) => {
      const saved = await updateAddress(
        tx,
        gate.pii,
        userId,
        params.data.id,
        body.data
      );
      if (typeof saved === 'string') return refusalOf(saved);
      await auditAddress(tx, request, userId, 'ADDRESS_UPDATED', saved);
      return { status: 200, body: addressSavedSchema.parse(saved) };
    });
  });

  app.delete('/v1/account/addresses/:id', async (request, reply) => {
    const gate = writeGate(deps, request, reply);
    if (gate === null) return reply;
    const params = addressParams.safeParse(request.params);
    if (!params.success) {
      return refuse(reply, 400, 'Invalid address', 'INVALID_ADDRESS');
    }
    return runOnce(deps, request, reply, gate.key, async (tx, userId) => {
      const refusal = await deleteAddress(tx, userId, params.data.id);
      if (refusal !== null) return refusalOf(refusal);
      await auditAddress(tx, request, userId, 'ADDRESS_DELETED', {
        id: params.data.id,
      });
      return { status: 204, body: null };
    });
  });

  app.post('/v1/account/forget-device', async (request, reply) => {
    const token = readDeviceToken(request.headers.cookie);
    if (token !== null) {
      await forgetDevice(deps.db, token, (request.user as SessionUser).userId);
    }
    return reply.header('Set-Cookie', clearedDeviceCookie()).code(204).send();
  });

  app.post('/v1/account/logout', async (request, reply) => {
    await closeSession(deps.db, (request.user as SessionUser).sessionId);
    return reply.header('Set-Cookie', clearedSessionCookie()).code(204).send();
  });

  app.get('/v1/account/orders', async (request, reply) => {
    const query = accountOrdersQuery.safeParse(request.query);
    if (!query.success) {
      return reply
        .code(400)
        .type(PROBLEM_TYPE)
        .send(problem(400, 'Invalid query', 'INVALID_REQUEST'));
    }
    // Lapsed reservations read EXPIRED, as on the buyer's return page.
    await expireOverdueOrders(deps.db, deps.now());
    const { items, total } = await listOrders(
      deps.db,
      { userId: (request.user as SessionUser).userId },
      query.data
    );
    return orderPageSchema.parse({ items, total, ...query.data });
  });

  app.get('/v1/account/orders/:order_number', async (request, reply) => {
    const { order_number: orderNumber } = request.params as {
      order_number: string;
    };
    const found = await lookUpOrder(deps, orderNumber);
    if (found === null) {
      return reply.code(404).type(PROBLEM_TYPE).send(problem(404, 'Not found'));
    }
    if (found.ownerId !== (request.user as SessionUser).userId) {
      return reply
        .code(403)
        .type(PROBLEM_TYPE)
        .send(problem(403, 'Not your order', 'DATA_DOMAIN_FORBIDDEN'));
    }
    return orderDetailSchema.parse(found.order);
  });
}
