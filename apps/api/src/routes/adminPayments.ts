/**
 * The routes of the payments mode switch (FC 075 F2, K-75 second part, T1.1):
 *
 * - `POST /v1/admin/payments/mode/prepare`: the owner or an administrator (the guard's
 *   `users:manage`, which only they hold) asks for the change, with a reason; the answer is a ticket
 *   of ten minutes. A body that is not the contract is 400 `INVALID_REQUEST`; asking for the mode
 *   the API already runs is 409 `SWITCH_TARGET_UNCHANGED`.
 * - `POST /v1/admin/payments/mode/confirm`: with an `Idempotency-Key`, the ticket, the canonical
 *   phrase and the code of the authenticator. The owner alone confirms: the answer to anyone else
 *   is 403 `SWITCH_OWNER_REQUIRED`, after the ticket, the phrase and the code (T1.1). A wrong
 *   ticket or phrase is 400 and a wrong code 403.
 *
 * The confirmation records an approval; the mode of this process does not change. The operator then
 * changes `PAYMENTS_MODE` and the keys in the environment and redeploys, and the start demands the
 * approval (services/paymentsModeGate.ts). Every refusal and approval is in the audit log.
 *
 * @module
 */
import type { FastifyInstance } from 'fastify';
import {
  paymentModeConfirmSchema,
  paymentModePrepareSchema,
} from '../../../../lib/account/paymentsBunkerTypes';
import type { ApiConfig, PaymentsConfig } from '../config';
import { problem, PROBLEM_TYPE } from '../lib/problem';
import type { Db, Transactional } from '../services/db';
import {
  checkIdempotencyKey,
  type MutationAnswer,
} from '../services/idempotency';
import type { SessionUser } from '../services/identity';
import type { SwitchCode } from '../services/paymentGates';
import {
  confirmModeSwitch,
  prepareModeSwitch,
} from '../services/paymentsModeSwitch';
import { refuse, runOnce } from './catalogMutation';

/** Dependencies of the routes. */
interface PaymentRouteDeps {
  /** Database with transactions. */
  db: Db & Transactional;
  /** Clock. */
  now: () => Date;
  /** The identity secrets, for the second factor; null while identity is not configured. */
  auth: ApiConfig['auth'];
  /** `PAYMENTS_MODE` of this environment. */
  mode: PaymentsConfig['mode'];
}

/** HTTP status and title of each refusal of T1.1. */
const REFUSALS: Record<
  Exclude<SwitchCode, 'SWITCH_PERMITTED'>,
  [number, string]
> = {
  SWITCH_CHALLENGE_INVALID: [400, 'Invalid or expired ticket'],
  SWITCH_PHRASE_MISMATCH: [400, 'The confirmation phrase does not match'],
  SWITCH_TOTP_FAILED: [403, 'The second factor failed'],
  SWITCH_OWNER_REQUIRED: [403, 'Only the owner confirms'],
};

/** A refusal of T1.1 as the answer of the mutation. */
function refusalOf(
  code: Exclude<SwitchCode, 'SWITCH_PERMITTED'>
): MutationAnswer {
  const [status, title] = REFUSALS[code];
  return { status, body: problem(status, title, code) };
}

/**
 * Registers the two routes of the payments mode switch.
 *
 * @param app - Fastify instance.
 * @param deps - Database, clock, identity secrets and the mode.
 */
export function registerAdminPaymentRoutes(
  app: FastifyInstance,
  deps: PaymentRouteDeps
): void {
  app.post('/v1/admin/payments/mode/prepare', async (request, reply) => {
    const body = paymentModePrepareSchema.safeParse(request.body);
    if (!body.success) {
      return refuse(reply, 400, 'Invalid request', 'INVALID_REQUEST');
    }
    const { userId } = request.user as SessionUser;
    const outcome = await deps.db.transaction((tx) =>
      prepareModeSwitch(
        tx,
        { ...body.data, currentMode: deps.mode },
        { userId, ip: request.ip },
        deps.now()
      )
    );
    if (outcome === 'SWITCH_TARGET_UNCHANGED') {
      return reply
        .code(409)
        .type(PROBLEM_TYPE)
        .send(
          problem(
            409,
            'The API already runs that mode',
            'SWITCH_TARGET_UNCHANGED'
          )
        );
    }
    return reply.code(201).send(outcome);
  });

  app.post('/v1/admin/payments/mode/confirm', async (request, reply) => {
    const key = checkIdempotencyKey(request.headers['idempotency-key']);
    if (key.code !== 'IDEMP_KEY_ACCEPTED') {
      return refuse(reply, 400, 'Idempotency-Key required', key.code);
    }
    const body = paymentModeConfirmSchema.safeParse(request.body);
    if (!body.success) {
      return refuse(reply, 400, 'Invalid request', 'INVALID_REQUEST');
    }
    if (!deps.auth) {
      return refuse(reply, 503, 'Identity unavailable', 'SERVICE_UNAVAILABLE');
    }
    const { totpKey } = deps.auth;
    const { roles } = request.user as SessionUser;
    return runOnce(deps, request, reply, key.key, async (tx, userId) => {
      const outcome = await confirmModeSwitch(
        tx,
        { ...body.data, owner: roles.includes('owner'), totpKey },
        { userId, ip: request.ip },
        deps.now()
      );
      if (typeof outcome === 'string') {
        return refusalOf(outcome as Exclude<SwitchCode, 'SWITCH_PERMITTED'>);
      }
      request.outboxQueued = true;
      return { status: 200, body: outcome };
    });
  });
}
