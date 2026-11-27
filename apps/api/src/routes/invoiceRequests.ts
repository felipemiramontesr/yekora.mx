/**
 * The requests for invoices (FC 077 F2).
 *
 * - The buyer asks for their own orders (`account:self`): the account is always the session's, and
 *   someone else's order is a 404 (A01).
 * - The staff asks for an order that has no account, a guest or a counter sale
 *   (`invoices:request`), and reads the queue (`invoices:read`).
 * - Both writes run once per `Idempotency-Key`; the fiscal data is judged first (T1.2) and the
 *   order inside the transaction (T1.1).
 *
 * @module
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  FISCAL_DATA_TITLES,
  fiscalDataVerdict,
} from '../../../../lib/account/fiscalTypes';
import {
  type InvoiceRequestInput,
  invoiceQueueQuery,
  invoiceQueueSchema,
  invoiceRequestedSchema,
  invoiceRequestSchema,
  orderInvoiceStateSchema,
  staffInvoiceRequestSchema,
} from '../../../../lib/account/invoiceTypes';
import { problem } from '../lib/problem';
import type { Db, Transactional } from '../services/db';
import { checkIdempotencyKey } from '../services/idempotency';
import type { SessionUser } from '../services/identity';
import {
  INVOICE_REFUSALS,
  type InvoiceSecrets,
  listInvoiceRequests,
  orderInvoiceState,
  requestInvoice,
} from '../services/invoiceRequests';
import { refuse, runOnce } from './catalogMutation';
import { ORDER_NUMBER } from './orders';

/** Dependencies of the routes of the requests. */
interface InvoiceRequestDeps {
  /** Database with transactions. */
  db: Db & Transactional;
  /** Clock. */
  now: () => Date;
  /** The keys of personal data, or null when the checkout secrets are not configured. */
  secrets: InvoiceSecrets | null;
}

const unavailable = (reply: FastifyReply) =>
  refuse(
    reply,
    503,
    'Personal data cannot be read or saved right now',
    'SERVICE_UNAVAILABLE'
  );

const notFound = (reply: FastifyReply) =>
  refuse(reply, ...INVOICE_REFUSALS.ORDER_NOT_FOUND, 'ORDER_NOT_FOUND');

const invalid = (reply: FastifyReply) =>
  refuse(reply, 400, 'Invalid request', 'INVALID_REQUEST');

/** The order number of the path, or null when it is not one. */
const orderOf = (request: FastifyRequest) => {
  const { order_number: orderNumber } = request.params as {
    order_number: string;
  };
  return ORDER_NUMBER.test(orderNumber) ? orderNumber : null;
};

/** Files a request: the key, the keys of personal data, the data (T1.2) and the order (T1.1). */
function file(
  deps: InvoiceRequestDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  asked: {
    orderNumber: string;
    data: InvoiceRequestInput;
    byOwner: boolean;
  }
) {
  const key = checkIdempotencyKey(request.headers['idempotency-key']);
  if (key.code !== 'IDEMP_KEY_ACCEPTED') {
    return refuse(reply, 400, 'Idempotency-Key required', key.code);
  }
  const { secrets } = deps;
  if (secrets === null) return unavailable(reply);
  const verdict = fiscalDataVerdict(asked.data);
  if (verdict !== 'FISCAL_DATA_ACCEPTED') {
    return refuse(reply, 400, FISCAL_DATA_TITLES[verdict], verdict);
  }
  return runOnce(deps, request, reply, key.key, async (tx, userId) => {
    const outcome = await requestInvoice(
      tx,
      {
        orderNumber: asked.orderNumber,
        ownerId: asked.byOwner ? userId : null,
        data: asked.data,
        now: deps.now(),
      },
      { secrets, userId, ip: request.ip }
    );
    if (typeof outcome === 'string') {
      const [status, title] = INVOICE_REFUSALS[outcome];
      return { status, body: problem(status, title, outcome) };
    }
    return { status: 201, body: invoiceRequestedSchema.parse(outcome) };
  });
}

/**
 * Registers the routes of the requests for invoices.
 *
 * @param app - Fastify instance.
 * @param deps - Database, clock and the keys of personal data.
 */
export function registerInvoiceRequestRoutes(
  app: FastifyInstance,
  deps: InvoiceRequestDeps
): void {
  const own = '/v1/account/orders/:order_number/invoice-request';

  app.post(own, async (request, reply) => {
    const orderNumber = orderOf(request);
    if (orderNumber === null) return notFound(reply);
    const body = invoiceRequestSchema.safeParse(request.body);
    if (!body.success) return invalid(reply);
    return file(deps, request, reply, {
      orderNumber,
      data: body.data,
      byOwner: true,
    });
  });

  app.get(own, async (request, reply) => {
    const orderNumber = orderOf(request);
    const state =
      orderNumber === null
        ? null
        : await orderInvoiceState(
            deps.db,
            orderNumber,
            (request.user as SessionUser).userId
          );
    return state === null
      ? notFound(reply)
      : orderInvoiceStateSchema.parse(state);
  });

  app.post('/v1/admin/invoices/requests', async (request, reply) => {
    const body = staffInvoiceRequestSchema.safeParse(request.body);
    if (!body.success) return invalid(reply);
    const { orderNumber, ...data } = body.data;
    if (!ORDER_NUMBER.test(orderNumber)) return notFound(reply);
    return file(deps, request, reply, { orderNumber, data, byOwner: false });
  });

  app.get('/v1/admin/invoices/requests', async (request, reply) => {
    const query = invoiceQueueQuery.safeParse(request.query);
    if (!query.success) return invalid(reply);
    if (deps.secrets === null) return unavailable(reply);
    return invoiceQueueSchema.parse(
      await listInvoiceRequests(deps.db, deps.secrets.piiKey, query.data)
    );
  });
}
