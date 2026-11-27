/**
 * The returns of the store (FC 071 F1, K-80): the buyer's request and the board of the panel.
 *
 * - `POST /v1/account/orders/:order_number/returns` (`account:self`): the buyer asks to return
 *   units of one of their delivered orders. Another account's order is a 403 DATA_DOMAIN_FORBIDDEN
 *   (T1.1 O); the rows of the table decide the rest (409 for a missing delivery, an expired window
 *   or a product that cannot be returned, 400 for units that cannot come back). One `Idempotency-Key`
 *   per request.
 * - `GET /v1/admin/returns` (`returns:view`): the board, newest first, optionally of one stage.
 * - `POST /v1/admin/returns/:id/prepare` (`returns:prepare`): the operator sets the amount and
 *   whether the units go back to the shelf. One `Idempotency-Key`.
 * - `POST /v1/admin/returns/:id/confirm` (`returns:confirm`): another operator executes the
 *   refund (T1.2). It takes no `Idempotency-Key`: the stage machine and the idempotency key sent
 *   to the processor already make a repeated call safe, and a refused or failed attempt must be
 *   retryable at once.
 *
 * The guard of app.ts has already checked the session, the authenticator and the permission.
 *
 * @module
 */
import type { FastifyInstance } from 'fastify';
import {
  posReturnRequestSchema,
  returnConfirmRequestSchema,
  returnListQuery,
  returnParams,
  returnPrepareRequestSchema,
  returnRequestSchema,
} from '../../../../lib/account/returnTypes';
import { problem, PROBLEM_TYPE } from '../lib/problem';
import type { ProcessorCode } from '../services/checkout';
import type { Db, Transactional } from '../services/db';
import type { SessionUser } from '../services/identity';
import {
  checkIdempotencyKey,
  type MutationAnswer,
} from '../services/idempotency';
import type { PaymentProcessorPort } from '../services/paymentPort';
import {
  confirmReturn,
  listReturns,
  prepareReturn,
  readProcessorRefunded,
  RETURN_REFUSALS,
  type ReturnRefusal,
  requestReturn,
} from '../services/returnsService';
import { refuse, runOnce } from './catalogMutation';
import { ORDER_NUMBER } from './orders';

/** Dependencies of the returns routes. */
interface ReturnsDeps {
  /** Database with transactions. */
  db: Db & Transactional;
  /** Clock. */
  now: () => Date;
  /** The processors whose secrets are configured; a return is refunded through the one that took the payment. */
  processors: Partial<Record<ProcessorCode, PaymentProcessorPort>>;
}

/** A refusal of the services as the answer of a mutation. */
function refusalOf(code: ReturnRefusal): MutationAnswer {
  const [status, title] = RETURN_REFUSALS[code];
  return { status, body: problem(status, title, code) };
}

/**
 * Registers the four routes of the returns.
 *
 * @param app - Fastify instance.
 * @param deps - Database, clock and the processors.
 */
export function registerReturnRoutes(
  app: FastifyInstance,
  deps: ReturnsDeps
): void {
  app.post(
    '/v1/account/orders/:order_number/returns',
    async (request, reply) => {
      const key = checkIdempotencyKey(request.headers['idempotency-key']);
      if (key.code !== 'IDEMP_KEY_ACCEPTED') {
        return refuse(reply, 400, 'Idempotency-Key required', key.code);
      }
      const { order_number: orderNumber } = request.params as {
        order_number: string;
      };
      const body = returnRequestSchema.safeParse(request.body);
      if (!ORDER_NUMBER.test(orderNumber) || !body.success) {
        return refuse(reply, 400, 'Invalid request', 'RETURN_PAYLOAD_INVALID');
      }
      return runOnce(deps, request, reply, key.key, async (tx, userId) => {
        const outcome = await requestReturn(
          tx,
          { orderNumber, userId, request: body.data, now: deps.now() },
          { userId, ip: request.ip }
        );
        return typeof outcome === 'string'
          ? refusalOf(outcome)
          : { status: 201, body: outcome };
      });
    }
  );

  // FC 076 F3: the staff asks for the return of a counter sale; the rest of the flow is the same.
  app.post('/v1/admin/returns/pos', async (request, reply) => {
    const key = checkIdempotencyKey(request.headers['idempotency-key']);
    if (key.code !== 'IDEMP_KEY_ACCEPTED') {
      return refuse(reply, 400, 'Idempotency-Key required', key.code);
    }
    const body = posReturnRequestSchema.safeParse(request.body);
    if (!body.success) {
      return refuse(reply, 400, 'Invalid request', 'RETURN_PAYLOAD_INVALID');
    }
    const { orderNumber, ...asked } = body.data;
    return runOnce(deps, request, reply, key.key, async (tx, userId) => {
      const outcome = await requestReturn(
        tx,
        {
          orderNumber,
          userId,
          request: asked,
          now: deps.now(),
          counter: true,
        },
        { userId, ip: request.ip }
      );
      return typeof outcome === 'string'
        ? refusalOf(outcome)
        : { status: 201, body: outcome };
    });
  });

  app.get('/v1/admin/returns', async (request, reply) => {
    const query = returnListQuery.safeParse(request.query);
    if (!query.success) {
      return refuse(reply, 400, 'Invalid filter', 'RETURN_PAYLOAD_INVALID');
    }
    return listReturns(deps.db, query.data.status ?? null);
  });

  app.post('/v1/admin/returns/:id/prepare', async (request, reply) => {
    const key = checkIdempotencyKey(request.headers['idempotency-key']);
    if (key.code !== 'IDEMP_KEY_ACCEPTED') {
      return refuse(reply, 400, 'Idempotency-Key required', key.code);
    }
    const params = returnParams.safeParse(request.params);
    const body = returnPrepareRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return refuse(reply, 400, 'Invalid request', 'RETURN_PAYLOAD_INVALID');
    }
    // T2.2: the cap counts what the processor already refunded, read before the transaction.
    const processorRefundedCents = await readProcessorRefunded(
      deps,
      params.data.id
    );
    if (processorRefundedCents === 'REFUND_PROCESSOR_ERROR') {
      const [status, title] = RETURN_REFUSALS[processorRefundedCents];
      return refuse(reply, status, title, processorRefundedCents);
    }
    return runOnce(deps, request, reply, key.key, async (tx, userId) => {
      const outcome = await prepareReturn(
        tx,
        params.data.id,
        { ...body.data, processorRefundedCents },
        { userId, ip: request.ip },
        deps.now()
      );
      return typeof outcome === 'string'
        ? refusalOf(outcome)
        : { status: 200, body: outcome };
    });
  });

  app.post('/v1/admin/returns/:id/confirm', async (request, reply) => {
    const params = returnParams.safeParse(request.params);
    const body = returnConfirmRequestSchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) {
      return refuse(reply, 400, 'Invalid request', 'RETURN_PAYLOAD_INVALID');
    }
    const user = request.user as SessionUser;
    const answer = await confirmReturn(
      deps,
      params.data.id,
      {
        userId: user.userId,
        canConfirm: user.permissions.includes('returns:confirm'),
        manualReference: body.data.manualReference ?? null,
        refundMethod: body.data.refundMethod ?? null,
      },
      request.ip
    );
    if (answer.status >= 400) reply.type(PROBLEM_TYPE);
    return reply.code(answer.status).send(answer.body);
  });
}
