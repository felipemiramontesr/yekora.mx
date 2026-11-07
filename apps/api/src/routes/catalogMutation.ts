/**
 * How every catalog mutation runs (FC 029 F2, ADR 0014): one place for the order of checks the
 * truth tables fix, so no route can skip one.
 *
 * 1. The guard of app.ts: session and `catalog:write`, else CAT_FORBIDDEN (T1.1 P).
 * 2. The `Idempotency-Key`: absent or malformed is a 400 (T1.3 K, F).
 * 3. The payload: parameters and body against their Zod schemas, else 400 CAT_VALIDATION_ERROR
 *    (T1.1 V).
 * 4. The mutation, at most once per key (T2.3a, T2.3d, T2.3e), with its `audit_log` entry in the
 *    same transaction (T2.4). A taken slug or code is a 409 CAT_CONFLICT, an unknown id a 404
 *    CAT_NOT_FOUND, a write on the system group a 409 CAT_SYSTEM_GROUP_LOCKED (T2.1b).
 *
 * @module
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { problem, PROBLEM_TYPE } from '../lib/problem';
import { recordAudit } from '../services/audit';
import type { Change } from '../services/catalogAdmin';
import type { ProductRefusal } from '../services/catalogProducts';
import type { Db, Transactional, TxQuery } from '../services/db';
import type { SessionUser } from '../services/identity';
import {
  checkIdempotencyKey,
  IDEMPOTENCY_KEY_SYNTAX,
  type MutationAnswer,
  requestHash,
  runIdempotent,
} from '../services/idempotency';

/** Dependencies of the catalog backoffice. */
export interface CatalogAdminDeps {
  /** Database with transactions. */
  db: Db & Transactional;
  /** Clock. */
  now: () => Date;
  /** GitHub token that dispatches deploy.yml (FC 029 T2.5); null keeps publishing closed. */
  publishToken: string | null;
}

/** Headers every catalog mutation reads (T1.3); the contract documents them. */
export const mutationHeaders = z.object({
  'idempotency-key': z.string().regex(IDEMPOTENCY_KEY_SYNTAX),
});

/** Path parameter of one catalog row. */
export const idParams = z.object({ id: z.coerce.number().int().positive() });

/** Status and title of each refusal a mutation may name. */
const REFUSALS: Readonly<Record<ProductRefusal, readonly [number, string]>> = {
  CAT_NOT_FOUND: [404, 'Not found'],
  CAT_SYSTEM_GROUP_LOCKED: [409, 'System facet group is locked'],
  CAT_VALIDATION_ERROR: [400, 'Invalid catalog data'],
  CAT_REFERENCE_INVALID: [422, 'Unknown or retired reference'],
  CAT_STOCK_BELOW_RESERVED: [409, 'Stock below reserved units'],
};

/**
 * Sends a problem with its code as detail.
 *
 * @param reply - The reply.
 * @param status - HTTP status.
 * @param title - Short summary.
 * @param code - Machine-readable code (T1.x / T2.x of FC 029).
 * @returns The sent reply.
 */
export function refuse(
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

/** One mutation: what it does in the transaction, given who acts. */
type Mutation = (tx: TxQuery, userId: string) => Promise<MutationAnswer>;

/**
 * Sends one catalog mutation through its Idempotency-Key: 409 on a key reused for another
 * request, else the answer of the first run, now or replayed.
 *
 * @param deps - Database and clock.
 * @param request - The request (its user, method, route and body name the key's request).
 * @param reply - The reply.
 * @param key - The accepted key.
 * @param mutation - The work.
 * @returns The sent reply.
 */
export async function runOnce(
  deps: CatalogAdminDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  key: string,
  mutation: Mutation
) {
  // The guard set the user: no catalog route is public.
  const userId = (request.user as SessionUser).userId;
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
  const { status, body } = outcome.answer;
  if (status >= 400) reply.type(PROBLEM_TYPE);
  return reply
    .code(status)
    .header('idempotency-status', outcome.code)
    .send(body);
}

/** Whether a driver error is a duplicate key (a slug or code already taken). */
const isDuplicate = (error: unknown) =>
  (error as { code?: string } | null)?.code === 'ER_DUP_ENTRY';

/** A JSON mutation of one catalog entity. */
interface MutationRoute<Params, Body> {
  method: 'POST' | 'PATCH';
  url: string;
  /** What `audit_log` calls the entity. */
  entityType: string;
  params?: z.ZodType<Params>;
  body: z.ZodType<Body>;
  /** The write; a refusal names why nothing changed. */
  run: (
    tx: TxQuery,
    input: { params: Params; body: Body }
  ) => Promise<Change<{ id: number }> | ProductRefusal>;
}

/**
 * Registers one JSON mutation with the checks in the order of this module.
 *
 * @param app - Fastify instance.
 * @param deps - Database and clock.
 * @param route - Method, URL, schemas and the write.
 */
export function mutationRoute<Params, Body>(
  app: FastifyInstance,
  deps: CatalogAdminDeps,
  route: MutationRoute<Params, Body>
): void {
  app.route({
    method: route.method,
    url: route.url,
    handler: async (request, reply) => {
      const key = checkIdempotencyKey(request.headers['idempotency-key']);
      if (key.code !== 'IDEMP_KEY_ACCEPTED') {
        return refuse(reply, 400, 'Idempotency-Key required', key.code);
      }
      const params = (route.params ?? z.object({})).safeParse(request.params);
      const body = route.body.safeParse(request.body);
      if (!params.success || !body.success) {
        return refuse(
          reply,
          400,
          'Invalid catalog data',
          'CAT_VALIDATION_ERROR'
        );
      }
      return runOnce(deps, request, reply, key.key, async (tx, userId) => {
        let change: Change<{ id: number }> | ProductRefusal;
        try {
          change = await route.run(tx, {
            params: params.data as Params,
            body: body.data,
          });
        } catch (error) {
          if (!isDuplicate(error)) throw error;
          return {
            status: 409,
            body: problem(409, 'Already exists', 'CAT_CONFLICT'),
          };
        }
        if (typeof change === 'string') {
          const [status, title] = REFUSALS[change];
          return { status, body: problem(status, title, change) };
        }
        await recordAudit(tx, {
          userId,
          action: `${route.method} ${route.url}`,
          entityType: route.entityType,
          entityId: String(change.after.id),
          before: change.before,
          after: change.after,
          ip: request.ip,
        });
        return { status: change.before ? 200 : 201, body: change.after };
      });
    },
  });
}
