/**
 * The catalog backoffice (FC 029 F2, ADR 0012, ADR 0014): `/v1/admin/catalog/*`.
 *
 * Every route needs `catalog:write` (T1.1 P): the guard of app.ts refuses a missing permission
 * before anything else, with CAT_FORBIDDEN. Then:
 * - DELETE is refused on the whole namespace with 405 CAT_DELETE_FORBIDDEN (T1.1 M, T2.3b):
 *   the catalog only retires rows with `is_active = 0` (T2.3c);
 * - every mutation needs an `Idempotency-Key` (T1.3), checked before the payload, and runs at
 *   most once per key (services/idempotency.ts), with its `audit_log` entry in the same
 *   transaction (T2.4).
 *
 * F2a: images. `POST /v1/admin/catalog/media` takes the raw bytes of the Canvas crop with their
 * type as Content-Type and stores them once per digest (T1.2, T2.2a, T2.2b).
 *
 * @module
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { problem, PROBLEM_TYPE } from '../lib/problem';
import { SAFE_IMAGE_TYPES } from '../services/imageProbe';
import { recordAudit } from '../services/audit';
import type { Db, Transactional, TxQuery } from '../services/db';
import type { SessionUser } from '../services/identity';
import {
  checkIdempotencyKey,
  IDEMPOTENCY_KEY_SYNTAX,
  type MutationAnswer,
  requestHash,
  runIdempotent,
} from '../services/idempotency';
import { inspectMedia, SHA256_HEX, storeMedia } from '../services/media';

/** Dependencies of the catalog backoffice. */
interface CatalogAdminDeps {
  /** Database with transactions. */
  db: Db & Transactional;
  /** Clock. */
  now: () => Date;
}

/** Headers every catalog mutation reads (T1.3); the contract documents them. */
export const mutationHeaders = z.object({
  'idempotency-key': z.string().regex(IDEMPOTENCY_KEY_SYNTAX),
});

/** Answer of an accepted upload: the digest the image is served under and what was probed. */
export const mediaUploadedSchema = z.object({
  code: z.literal('MEDIA_ACCEPTED'),
  created: z.boolean(),
  sha256: z.string().regex(SHA256_HEX),
  mimeType: z.enum(SAFE_IMAGE_TYPES),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sizeBytes: z.number().int().positive(),
});

/** Largest body read from an upload: twice the 2 MB limit, so the service names the refusal. */
const UPLOAD_READ_LIMIT = 4 * 1024 * 1024;

/** Status and title of each refusal of an upload (T1.2). */
const MEDIA_REFUSALS = {
  MEDIA_UNSAFE_TYPE: [415, 'Unsupported image type'],
  MEDIA_SIZE_EXCEEDED: [413, 'Image too large'],
  MEDIA_DIMENSIONS_INVALID: [422, 'Image dimensions not allowed'],
} as const;

/** Sends a problem with its code as detail. */
function refuse(
  reply: FastifyReply,
  status: number,
  title: string,
  code: string
) {
  return reply
    .code(status)
    .type(PROBLEM_TYPE)
    .send(problem(status, title, code));
}

/** The signed-in user; the guard of app.ts set it, since no catalog route is public. */
function actorOf(request: FastifyRequest): string {
  return (request.user as SessionUser).userId;
}

/** One mutation: what it does in the transaction, given who acts. */
type Mutation = (tx: TxQuery, userId: string) => Promise<MutationAnswer>;

/**
 * Sends one catalog mutation through its Idempotency-Key: 409 on a key reused for another
 * request, else the answer of the first run (now or replayed).
 */
async function runOnce(
  deps: CatalogAdminDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  key: string,
  mutation: Mutation
) {
  const userId = actorOf(request);
  const outcome = await runIdempotent(
    deps.db,
    {
      userId,
      key,
      route: `${request.method} ${request.routeOptions.url}`,
      requestHash: requestHash(
        String(request.headers['content-type']),
        request.body
      ),
      now: deps.now(),
    },
    (tx) => mutation(tx, userId)
  );
  if (outcome.code === 'IDEMP_PAYLOAD_MISMATCH') {
    return refuse(reply, 409, 'Idempotency-Key reused', outcome.code);
  }
  return reply
    .code(outcome.answer.status)
    .header('idempotency-status', outcome.code)
    .send(outcome.answer.body);
}

/**
 * Registers the catalog backoffice.
 *
 * @param app - Fastify instance.
 * @param deps - Database and clock.
 */
export function registerCatalogAdminRoutes(
  app: FastifyInstance,
  deps: CatalogAdminDeps
): void {
  // Image bytes reach the upload route as a Buffer; any other image type (SVG included) too,
  // so the signature check, not the parser, refuses it with MEDIA_UNSAFE_TYPE.
  app.addContentTypeParser(
    /^image\/[a-z0-9.+-]+$/,
    { parseAs: 'buffer', bodyLimit: UPLOAD_READ_LIMIT },
    (_request, body, done) => done(null, body)
  );

  app.post(
    '/v1/admin/catalog/media',
    {
      bodyLimit: UPLOAD_READ_LIMIT,
      errorHandler: (error, _request, reply) => {
        if ((error as { code?: string }).code !== 'FST_ERR_CTP_BODY_TOO_LARGE')
          throw error;
        return refuse(reply, 413, 'Image too large', 'MEDIA_SIZE_EXCEEDED');
      },
    },
    async (request, reply) => {
      const key = checkIdempotencyKey(request.headers['idempotency-key']);
      if (key.code !== 'IDEMP_KEY_ACCEPTED') {
        return refuse(reply, 400, 'Idempotency-Key required', key.code);
      }
      const bytes = request.body;
      const verdict = Buffer.isBuffer(bytes)
        ? inspectMedia(bytes, String(request.headers['content-type']))
        : ({ code: 'MEDIA_UNSAFE_TYPE' } as const);
      if (verdict.code !== 'MEDIA_ACCEPTED') {
        const [status, title] = MEDIA_REFUSALS[verdict.code];
        return refuse(reply, status, title, verdict.code);
      }
      return runOnce(deps, request, reply, key.key, async (tx, userId) => {
        const created = await storeMedia(tx, bytes as Buffer, verdict);
        const { code, ...stored } = verdict;
        await recordAudit(tx, {
          userId,
          action: 'POST /v1/admin/catalog/media',
          entityType: 'media',
          entityId: verdict.sha256,
          before: created ? null : stored,
          after: stored,
          ip: request.ip,
        });
        return { status: 201, body: { code, created, ...stored } };
      });
    }
  );

  // T2.3b: nothing in the catalog is ever deleted; retiring is `is_active = 0` (T2.3c).
  app.delete('/v1/admin/catalog/*', (_request, reply) =>
    reply
      .code(405)
      .header('Allow', 'GET, HEAD, POST, PUT, PATCH')
      .type(PROBLEM_TYPE)
      .send(problem(405, 'Method not allowed', 'CAT_DELETE_FORBIDDEN'))
  );
}
