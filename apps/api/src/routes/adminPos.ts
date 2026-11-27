/**
 * The routes of the point of sale (FC 076 F1, K-79), under `/v1/admin/pos`:
 *
 * - `GET shifts/current` (`pos:shift`): the open shift without its expected cash, so the count
 *   stays blind.
 * - `POST shifts/open`, `POST shifts/movements`, `POST shifts/:id/close` (`pos:shift`): the till.
 *   Each write asks for an `Idempotency-Key`, so a double click never opens, moves cash or closes
 *   twice; `pos:supervisor` lets close another person's shift or a big difference, and take out
 *   more than 2,000 MXN (T1.2, T1.4).
 *
 * A refusal is a problem whose `detail` is the row of its table; the session guard answers first.
 *
 * @module
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  cashMovementSchema,
  closeShiftSchema,
  openShiftSchema,
  posProductsQuery,
  posSaleSchema,
  receiptQuery,
  shiftParams,
} from '../../../../lib/account/posTypes';
import type { CheckoutSecrets } from '../config';
import { problem } from '../lib/problem';
import type { Db, Transactional } from '../services/db';
import {
  checkIdempotencyKey,
  type MutationAnswer,
} from '../services/idempotency';
import type { SessionUser } from '../services/identity';
import { posProducts, sellAtCounter } from '../services/posCheckout';
import { posReceipt } from '../services/posReceipt';
import {
  closeShift,
  currentShift,
  moveCash,
  openShift,
  type PosActor,
} from '../services/posShifts';
import { refuse, runOnce } from './catalogMutation';

/** Dependencies of the routes. */
interface PosDeps {
  /** Database with transactions. */
  db: Db & Transactional;
  /** Clock. */
  now: () => Date;
  /** The secrets that seal a buyer's data; null while the checkout is not configured. */
  checkout: CheckoutSecrets | null;
}

/** HTTP status and title of each refusal of the till. */
const REFUSALS: Record<string, [number, string]> = {
  POS_SHIFT_ALREADY_OPEN: [409, 'A shift is already open'],
  PERMISSION_DENIED: [403, 'Permission denied'],
  SHIFT_NOT_OPEN_REJECT: [409, 'The shift is not open'],
  MISSING_DIFF_JUSTIFICATION_REJECT: [400, 'A difference needs a note'],
  SUPERVISOR_REQUIRED_FOR_LARGE_DIFF: [403, 'A supervisor must close it'],
  INSUFFICIENT_DRAWER_CASH_REJECT: [400, 'The drawer does not hold it'],
  SUPERVISOR_PERMISSION_REQUIRED: [403, 'A supervisor must take it out'],
  POS_PRODUCT_UNKNOWN: [400, 'A product does not exist or is retired'],
  INSUFFICIENT_STOCK_REJECT: [409, 'There is not enough stock'],
  STOCK_RESERVED_ONLINE_REJECT: [409, 'The units are reserved online'],
  POS_SHIFT_CLOSED_REJECT: [409, 'Open a shift before selling'],
  INVALID_POS_METHOD_REJECT: [400, 'Not a method of the counter'],
  INSUFFICIENT_TENDERED_REJECT: [400, 'The cash does not cover the total'],
  TERMINAL_AMOUNT_MISMATCH_REJECT: [400, 'The terminal charged another amount'],
  INVALID_VOUCHER_DATA_REJECT: [400, 'The voucher data is incomplete'],
};

/** A refusal as the answer of a mutation. */
function refusalOf(code: string): MutationAnswer {
  const [status, title] = REFUSALS[code];
  return { status, body: problem(status, title, code) };
}

/** The actor of a request: the guard set the user, no route here is public. */
function actorOf(request: FastifyRequest): PosActor {
  const user = request.user as SessionUser;
  return {
    userId: user.userId,
    supervisor: user.permissions.includes('pos:supervisor'),
    ip: request.ip,
  };
}

/** Runs a write once per `Idempotency-Key`, after the body is the contract's. */
function write<Body>(
  deps: PosDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  body: Body | undefined,
  run: (
    tx: Parameters<Parameters<typeof runOnce>[4]>[0],
    body: Body,
    actor: PosActor
  ) => Promise<MutationAnswer>
) {
  const key = checkIdempotencyKey(request.headers['idempotency-key']);
  if (key.code !== 'IDEMP_KEY_ACCEPTED') {
    return refuse(reply, 400, 'Idempotency-Key required', key.code);
  }
  if (body === undefined) {
    return refuse(reply, 400, 'Invalid request', 'INVALID_REQUEST');
  }
  const actor = actorOf(request);
  return runOnce(deps, request, reply, key.key, (tx) => run(tx, body, actor));
}

/**
 * Registers the routes of the point of sale: the till and the sale.
 *
 * @param app - Fastify instance.
 * @param deps - Database and clock.
 */
export function registerPosRoutes(app: FastifyInstance, deps: PosDeps): void {
  app.get('/v1/admin/pos/shifts/current', async () => ({
    shift: await currentShift(deps.db),
  }));

  app.post('/v1/admin/pos/shifts/open', async (request, reply) =>
    write(
      deps,
      request,
      reply,
      openShiftSchema.safeParse(request.body).data,
      async (tx, body, actor) => {
        const outcome = await openShift(tx, body.openingCashMxnCents, actor);
        return typeof outcome === 'string'
          ? refusalOf(outcome)
          : { status: 201, body: outcome };
      }
    )
  );

  app.post('/v1/admin/pos/shifts/movements', async (request, reply) =>
    write(
      deps,
      request,
      reply,
      cashMovementSchema.safeParse(request.body).data,
      async (tx, body, actor) => {
        const outcome = await moveCash(tx, body, actor);
        return typeof outcome === 'string'
          ? refusalOf(outcome)
          : { status: 201, body: outcome };
      }
    )
  );

  app.post('/v1/admin/pos/shifts/:id/close', async (request, reply) => {
    const params = shiftParams.safeParse(request.params);
    const body = closeShiftSchema.safeParse(request.body).data;
    return write(
      deps,
      request,
      reply,
      params.success && body ? { id: params.data.id, ...body } : undefined,
      async (tx, input, actor) => {
        const outcome = await closeShift(
          tx,
          input.id,
          input,
          actor,
          deps.now()
        );
        return typeof outcome === 'string'
          ? refusalOf(outcome)
          : { status: 200, body: outcome };
      }
    );
  });
  app.get('/v1/admin/pos/products', async (request, reply) => {
    const query = posProductsQuery.safeParse(request.query);
    if (!query.success) {
      return refuse(reply, 400, 'Invalid request', 'INVALID_REQUEST');
    }
    return posProducts(deps.db, query.data.q);
  });

  app.post('/v1/admin/pos/checkout', async (request, reply) => {
    const { checkout: secrets } = deps;
    if (secrets === null) {
      return refuse(reply, 503, 'Checkout unavailable', 'SERVICE_UNAVAILABLE');
    }
    return write(
      deps,
      request,
      reply,
      posSaleSchema.safeParse(request.body).data,
      async (tx, body, actor) => {
        const outcome = await sellAtCounter(tx, body, {
          actor,
          secrets,
          now: deps.now(),
        });
        if (typeof outcome === 'string') return refusalOf(outcome);
        if (body.customerEmail !== undefined) request.outboxQueued = true;
        return { status: 201, body: outcome };
      }
    );
  });
  app.get(
    '/v1/admin/pos/orders/:order_number/receipt',
    async (request, reply) => {
      const query = receiptQuery.safeParse(request.query);
      if (!query.success) {
        return refuse(reply, 400, 'Invalid request', 'INVALID_REQUEST');
      }
      const { order_number: orderNumber } = request.params as {
        order_number: string;
      };
      const receipt = await posReceipt(
        deps.db,
        orderNumber,
        query.data.width === '58' ? 58 : 80
      );
      return receipt ?? refuse(reply, 404, 'Not found', 'ORDER_NOT_FOUND');
    }
  );
}
