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
 * - `payment-methods` (FC 054) are the cards the account keeps at Stripe: list, open Stripe's page
 *   to add one (`setup`), detach one. The card never reaches this API: the list is read from
 *   Stripe each time (brand, last four, expiry) and forgotten; another account's card id answers
 *   404 like one that does not exist. Without a Stripe key the three answer 503.
 * - `orders` lists the buyer's own orders, always filtered by the session's user (T2.6b), and
 *   `orders/:order_number` shows one of them; another account's order, or a guest purchase, is
 *   refused with 403 DATA_DOMAIN_FORBIDDEN (T1.2 D). Read-only (T2.6a, routes/orders.ts).
 *
 * @module
 */
import { createHash } from 'node:crypto';
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
  paymentMethodDetachResponseSchema,
  paymentMethodSettleResponseSchema,
  paymentMethodListResponseSchema,
  paymentMethodParams,
  paymentMethodSetupResponseSchema,
} from '../../../../lib/account/paymentMethodTypes';
import {
  accountOrdersQuery,
  orderDetailSchema,
  orderPageSchema,
} from '../../../../lib/account/orderTypes';
import { unsupportedLocale } from '../lib/language';
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
import {
  detachSavedCard,
  listSavedCards,
  settleSavedCards,
  startCardSetup,
} from '../services/accountPaymentMethods';
import { PaymentProcessorError } from '../services/paymentPort';
import type { StripeCardsPort } from '../services/stripeAdapter';
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
  /** The saved-cards client of Stripe, or null without a Stripe key (FC 054). */
  cards: StripeCardsPort | null;
  /** Public site, where Stripe returns the person after adding a card. */
  siteUrl: string;
}

/** FC 057 T2.5: the routes of the cards answer 10 requests a minute from one address. */
const CARDS_LIMIT = {
  config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
};

/** What the person finds in the address when Stripe sends them back after adding a card (FC 057). */
const CARD_ADDED_MARK = '?setup=done';

/** A fingerprint of a Stripe card id for the audit trail: it identifies the card, never says which. */
const fingerprint = (id: string) =>
  createHash('sha256').update(id).digest('hex').slice(0, 16);

/** Where Stripe sends the person back to, by language (FC 054 T2.4). */
const CARDS_PAGE = {
  'es-MX': '/cuenta/metodos-pago/',
  en: '/en/account/metodos-pago/',
} as const;

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

/**
 * The gate of the writes to the saved cards (FC 054 T1.1, T1.2): a valid `Idempotency-Key`, then
 * the Stripe key. The session, the third condition, was checked by the guard before.
 *
 * @returns The idempotency key and the Stripe client, or null once the refusal has been sent.
 */
function cardsWriteGate(
  deps: Pick<AccountDeps, 'cards'>,
  request: FastifyRequest,
  reply: FastifyReply
): { key: string; cards: StripeCardsPort } | null {
  const key = checkIdempotencyKey(request.headers['idempotency-key']);
  if (key.code !== 'IDEMP_KEY_ACCEPTED') {
    refuse(reply, 400, 'Idempotency-Key required', key.code);
    return null;
  }
  if (deps.cards === null) {
    refuse(reply, 503, 'Cards cannot be kept right now', 'SERVICE_UNAVAILABLE');
    return null;
  }
  return { key: key.key, cards: deps.cards };
}

/** What a write answers when Stripe does not: never an error page, and never stored. */
const stripeDown = () => ({
  status: 503,
  body: problem(503, 'Stripe did not answer', 'SERVICE_UNAVAILABLE'),
});

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
      return {
        phone: null,
        postalCode: null,
        stateCode: null,
        preferredLocale: undefined,
      };
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
    // FC 067 T1.2: a language outside the catalog is refused by name.
    if (unsupportedLocale(request.body, 'preferredLocale')) {
      return refuse(
        reply,
        400,
        'Unsupported language',
        'LOCALE_INPUT_UNSUPPORTED'
      );
    }
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
        after: {
          changed:
            body.data.preferredLocale === undefined
              ? ['fullName', 'phone']
              : ['fullName', 'phone', 'preferredLocale'],
        },
        ip: request.ip,
      });
      return {
        status: 200,
        body: profileUpdatedSchema.parse({
          fullName: body.data.fullName,
          preferredLocale: body.data.preferredLocale,
        }),
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

  app.get(
    '/v1/account/payment-methods',
    CARDS_LIMIT,
    async (request, reply) => {
      if (deps.cards === null) {
        return refuse(
          reply,
          503,
          'Cards cannot be read right now',
          'SERVICE_UNAVAILABLE'
        );
      }
      try {
        const saved = await listSavedCards(
          deps.db,
          deps.cards,
          (request.user as SessionUser).userId
        );
        return paymentMethodListResponseSchema.parse(saved);
      } catch (error) {
        if (!(error instanceof PaymentProcessorError)) throw error;
        request.log.warn(
          { err: error },
          `saved cards: Stripe refused the list: ${error.message}`
        );
        return refuse(
          reply,
          503,
          'Stripe did not answer',
          'SERVICE_UNAVAILABLE'
        );
      }
    }
  );

  app.post(
    '/v1/account/payment-methods/setup',
    CARDS_LIMIT,
    async (request, reply) => {
      const gate = cardsWriteGate(deps, request, reply);
      if (gate === null) return reply;
      const lang =
        (request.query as { lang?: unknown }).lang === 'en' ? 'en' : 'es-MX';
      const page = `${deps.siteUrl}${CARDS_PAGE[lang]}`;
      return runOnce(deps, request, reply, gate.key, async (tx, userId) => {
        try {
          const redirectUrl = await startCardSetup(tx, gate.cards, userId, {
            successUrl: `${page}${CARD_ADDED_MARK}`,
            cancelUrl: page,
          });
          return {
            status: 201,
            body: paymentMethodSetupResponseSchema.parse({ redirectUrl }),
          };
        } catch (error) {
          if (!(error instanceof PaymentProcessorError)) throw error;
          request.log.warn(
            { err: error },
            `saved cards: Stripe refused the setup: ${error.message}`
          );
          return stripeDown();
        }
      });
    }
  );

  app.delete(
    '/v1/account/payment-methods/:id',
    CARDS_LIMIT,
    async (request, reply) => {
      const gate = cardsWriteGate(deps, request, reply);
      if (gate === null) return reply;
      const params = paymentMethodParams.safeParse(request.params);
      if (!params.success) {
        return refuse(reply, 404, 'Not found', 'PAYMENT_METHOD_NOT_FOUND');
      }
      return runOnce(deps, request, reply, gate.key, async (tx, userId) => {
        try {
          const refusal = await detachSavedCard(
            tx,
            gate.cards,
            userId,
            params.data.id
          );
          if (refusal !== null) {
            return { status: 404, body: problem(404, 'Not found', refusal) };
          }
          // The audit trail says a card was detached and leaves its fingerprint, never the card.
          await recordAudit(tx, {
            userId,
            action: 'PAYMENT_METHOD_DETACHED',
            entityType: 'user_stripe_customers',
            entityId: userId,
            before: null,
            after: {
              detached_payment_method_id: fingerprint(params.data.id),
            },
            ip: request.ip,
          });
          return {
            status: 200,
            body: paymentMethodDetachResponseSchema.parse({ detached: true }),
          };
        } catch (error) {
          if (!(error instanceof PaymentProcessorError)) throw error;
          request.log.warn(
            { err: error },
            `saved cards: Stripe refused the detach: ${error.message}`
          );
          return stripeDown();
        }
      });
    }
  );

  app.post(
    '/v1/account/payment-methods/settle',
    CARDS_LIMIT,
    async (request, reply) => {
      const gate = cardsWriteGate(deps, request, reply);
      if (gate === null) return reply;
      return runOnce(deps, request, reply, gate.key, async (tx, userId) => {
        try {
          const settled = await settleSavedCards(tx, gate.cards, userId);
          if (settled === 'CARD_ATTACH_FAILED') {
            return {
              status: 400,
              body: problem(400, 'No card was saved', settled),
            };
          }
          if (settled === 'GATEWAY_DETACH_FAILED') {
            return {
              status: 502,
              body: problem(502, 'The previous card was not detached', settled),
            };
          }
          const replaced = settled.replaced.length > 0;
          // The trail says a card was saved or replaced, by fingerprints only, never by card data.
          await recordAudit(tx, {
            userId,
            action: replaced
              ? 'PAYMENT_METHOD_REPLACED'
              : 'PAYMENT_METHOD_SAVED',
            entityType: 'user_stripe_customers',
            entityId: userId,
            before: null,
            after: {
              new_payment_method_id: fingerprint(settled.card.id),
              ...(replaced && {
                replaced_payment_method_id: fingerprint(
                  settled.replaced.join(',')
                ),
              }),
            },
            ip: request.ip,
          });
          return {
            status: 200,
            body: paymentMethodSettleResponseSchema.parse({
              status: replaced ? 'replaced' : 'saved',
              paymentMethod: settled.card,
            }),
          };
        } catch (error) {
          if (!(error instanceof PaymentProcessorError)) throw error;
          request.log.warn(
            { err: error },
            `saved cards: Stripe refused the settle: ${error.message}`
          );
          return stripeDown();
        }
      });
    }
  );

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
