/**
 * The invoices themselves (FC 077 F3).
 *
 * - The staff uploads the XML and the PDF the external system gave, rejects a request that waits
 *   or cancels a completed one (`invoices:upload`), each once per `Idempotency-Key`.
 * - The buyer downloads the files of their own orders (`account:self`); someone else's is a 404
 *   (A01). The staff downloads any (`invoices:read`).
 * - A file is sent as an attachment, never cached and never sniffed, and each download is audited.
 *
 * @module
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  invoiceClosedSchema,
  invoiceCloseRequestSchema,
  invoiceParams,
  invoiceUploadedSchema,
  invoiceUploadRequestSchema,
} from '../../../../lib/account/invoiceTypes';
import { problem } from '../lib/problem';
import { recordAudit } from '../services/audit';
import type { Db, Transactional } from '../services/db';
import { checkIdempotencyKey } from '../services/idempotency';
import type { SessionUser } from '../services/identity';
import {
  closeInvoiceRequest,
  INVOICE_ADMIN_REFUSALS,
  readInvoiceFile,
  uploadInvoice,
} from '../services/invoicesService';
import { refuse, runOnce } from './catalogMutation';
import { ORDER_NUMBER } from './orders';

/** What the two files in base64 may weigh together, with room for the JSON around them. */
const UPLOAD_LIMIT = 4 * 1024 * 1024;

/** Dependencies of the invoice routes. */
interface AdminInvoiceDeps {
  /** Database with transactions. */
  db: Db & Transactional;
  /** Clock. */
  now: () => Date;
  /** The RFC the shop invoices with, or null when it is not configured. */
  fiscalRfc: string | null;
}

const FILE_TYPES = { xml: 'application/xml', pdf: 'application/pdf' } as const;
type FileKind = keyof typeof FILE_TYPES;

const refusalOf = (code: keyof typeof INVOICE_ADMIN_REFUSALS) => {
  const [status, title] = INVOICE_ADMIN_REFUSALS[code];
  return { status, body: problem(status, title, code) };
};

const invalid = (reply: FastifyReply) =>
  refuse(reply, 400, 'Invalid request', 'INVALID_REQUEST');

/** Sends one file of an order's invoice, or 404; `ownerId` limits it to the buyer's orders. */
async function sendFile(
  deps: AdminInvoiceDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  { kind, ownerId }: { kind: FileKind; ownerId: string | null }
) {
  const { order_number: orderNumber } = request.params as {
    order_number: string;
  };
  const file = ORDER_NUMBER.test(orderNumber)
    ? await readInvoiceFile(deps.db, orderNumber, kind, ownerId)
    : null;
  if (file === null) {
    return refuse(reply, 404, 'Not found', 'INVOICE_NOT_FOUND');
  }
  await recordAudit(deps.db, {
    userId: (request.user as SessionUser).userId,
    action: 'INVOICE_DOWNLOADED',
    entityType: 'orders',
    entityId: orderNumber,
    before: null,
    after: { file: kind },
    ip: request.ip,
  });
  return reply
    .type(FILE_TYPES[kind])
    .header('content-disposition', `attachment; filename="${file.filename}"`)
    .header('cache-control', 'private, no-store')
    .header('x-content-type-options', 'nosniff')
    .send(file.data);
}

/** Rejects or cancels a request, once per key, with the reason the person will read. */
function close(
  deps: AdminInvoiceDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  to: 'REJECTED' | 'CANCELLED'
) {
  const key = checkIdempotencyKey(request.headers['idempotency-key']);
  if (key.code !== 'IDEMP_KEY_ACCEPTED') {
    return refuse(reply, 400, 'Idempotency-Key required', key.code);
  }
  const params = invoiceParams.safeParse(request.params);
  const body = invoiceCloseRequestSchema.safeParse(request.body);
  if (!params.success || !body.success) return invalid(reply);
  return runOnce(deps, request, reply, key.key, async (tx, userId) => {
    const outcome = await closeInvoiceRequest(tx, params.data.id, {
      to,
      reason: body.data.reason,
      now: deps.now(),
      actor: { userId, ip: request.ip },
    });
    return typeof outcome === 'string'
      ? refusalOf(outcome)
      : { status: 200, body: invoiceClosedSchema.parse(outcome) };
  });
}

/**
 * Registers the upload, the rejection, the cancellation and the downloads.
 *
 * @param app - Fastify instance.
 * @param deps - Database, clock and the RFC of the shop.
 */
export function registerAdminInvoiceRoutes(
  app: FastifyInstance,
  deps: AdminInvoiceDeps
): void {
  app.post(
    '/v1/admin/invoices/requests/:id/upload',
    { bodyLimit: UPLOAD_LIMIT },
    async (request, reply) => {
      const key = checkIdempotencyKey(request.headers['idempotency-key']);
      if (key.code !== 'IDEMP_KEY_ACCEPTED') {
        return refuse(reply, 400, 'Idempotency-Key required', key.code);
      }
      const params = invoiceParams.safeParse(request.params);
      const body = invoiceUploadRequestSchema.safeParse(request.body);
      if (!params.success || !body.success) return invalid(reply);
      return runOnce(deps, request, reply, key.key, async (tx, userId) => {
        const outcome = await uploadInvoice(tx, params.data.id, body.data, {
          storeRfc: deps.fiscalRfc,
          actor: { userId, ip: request.ip },
        });
        if (typeof outcome === 'string') return refusalOf(outcome);
        request.outboxQueued = true;
        return { status: 200, body: invoiceUploadedSchema.parse(outcome) };
      });
    }
  );

  app.post('/v1/admin/invoices/requests/:id/reject', async (request, reply) =>
    close(deps, request, reply, 'REJECTED')
  );
  app.post('/v1/admin/invoices/requests/:id/cancel', async (request, reply) =>
    close(deps, request, reply, 'CANCELLED')
  );

  for (const kind of ['xml', 'pdf'] as const) {
    app.get(
      `/v1/account/orders/:order_number/invoice/${kind}`,
      async (request, reply) =>
        sendFile(deps, request, reply, {
          kind,
          ownerId: (request.user as SessionUser).userId,
        })
    );
    app.get(
      `/v1/admin/invoices/:order_number/download/${kind}`,
      async (request, reply) =>
        sendFile(deps, request, reply, { kind, ownerId: null })
    );
  }
}
