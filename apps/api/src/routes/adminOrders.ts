/**
 * The fulfillment of orders in the panel (FC 068 F1, K-48): the three `POST` routes under
 * `/v1/admin/orders/:order_number/` that take a paid order forward.
 *
 * The guard of app.ts checks the session, the authenticator and `orders:manage` first (T1.1 S:
 * 401 SESSION_INVALID_OR_EXPIRED, 403 SECOND_FACTOR_REQUIRED, 403 PERMISSION_DENIED). Then, in
 * order, the `Idempotency-Key`, the parameters, and the transition (services/ordersFsm.ts):
 *
 * - `POST …/prepare` PAID → PREPARING;
 * - `POST …/ship` PAID or PREPARING → SHIPPED, with `carrier`, `trackingNumber` and an optional
 *   `trackingUrl` (T1.1 P: a missing or too long one is a 400 ORDER_PAYLOAD_INVALID);
 * - `POST …/deliver` SHIPPED → DELIVERED.
 * An order in another status is a 409 ORDER_STATUS_CONFLICT (T1.1 C), an unknown one a 404
 * ORDER_NOT_FOUND. Writes run once per key. The order read routes stay read-only: `PUT`, `PATCH`
 * and `DELETE` on `/v1/admin/orders/:order_number` still answer 405 (routes/orders.ts).
 *
 * @module
 */
import type { FastifyInstance } from 'fastify';
import {
  type ShipRequest,
  shipRequestSchema,
} from '../../../../lib/account/fulfillmentTypes';
import { problem } from '../lib/problem';
import type { Db, Transactional } from '../services/db';
import {
  checkIdempotencyKey,
  type MutationAnswer,
} from '../services/idempotency';
import {
  type FulfillmentRefusal,
  type FulfillmentStep,
  transitionOrder,
} from '../services/ordersFsm';
import { refuse, runOnce } from './catalogMutation';
import { ORDER_NUMBER } from './orders';

/** Dependencies of the fulfillment routes. */
interface AdminOrdersDeps {
  /** Database with transactions. */
  db: Db & Transactional;
  /** Clock. */
  now: () => Date;
}

/** Status and title of each refusal of a transition. */
const REFUSALS: Readonly<
  Record<FulfillmentRefusal, readonly [number, string]>
> = {
  ORDER_NOT_FOUND: [404, 'Not found'],
  ORDER_STATUS_CONFLICT: [409, 'The order is not in a status that allows it'],
};

/** The three steps, with the route of each. */
const STEP_ROUTES: readonly FulfillmentStep[] = ['prepare', 'ship', 'deliver'];

/**
 * Registers the three fulfillment routes.
 *
 * @param app - Fastify instance.
 * @param deps - Database and clock.
 */
export function registerAdminOrderRoutes(
  app: FastifyInstance,
  deps: AdminOrdersDeps
): void {
  for (const step of STEP_ROUTES) {
    app.post(
      `/v1/admin/orders/:order_number/${step}`,
      async (request, reply) => {
        const key = checkIdempotencyKey(request.headers['idempotency-key']);
        if (key.code !== 'IDEMP_KEY_ACCEPTED') {
          return refuse(reply, 400, 'Idempotency-Key required', key.code);
        }
        const { order_number: orderNumber } = request.params as {
          order_number: string;
        };
        if (!ORDER_NUMBER.test(orderNumber)) {
          return refuse(reply, 400, 'Invalid order', 'ORDER_PAYLOAD_INVALID');
        }
        let parcel: ShipRequest | null = null;
        if (step === 'ship') {
          const body = shipRequestSchema.safeParse(request.body);
          if (!body.success) {
            return refuse(
              reply,
              400,
              'The shipment is incomplete',
              'ORDER_PAYLOAD_INVALID'
            );
          }
          parcel = body.data;
        }
        return runOnce(deps, request, reply, key.key, async (tx, userId) => {
          const outcome = await transitionOrder(
            tx,
            step,
            orderNumber,
            parcel,
            { userId, ip: request.ip },
            deps.now()
          );
          if (typeof outcome !== 'string') {
            return { status: 200, body: outcome } satisfies MutationAnswer;
          }
          const [status, title] = REFUSALS[outcome];
          return {
            status,
            body: problem(status, title, outcome),
          } satisfies MutationAnswer;
        });
      }
    );
  }
}
