/**
 * Idempotency of the catalog mutations (FC 029 F2, ADR 0014, T1.3, T2.3a, T2.3d, T2.3e).
 *
 * Every POST, PUT or PATCH under `/v1/admin/catalog/*` carries an `Idempotency-Key`. Its row in
 * `idempotency_keys` is scoped to the user (the key hash covers the user id), lives 24 hours and
 * holds the route, the hash of the request and the answer:
 * - no live row → the mutation runs and its answer is stored in the same transaction
 *   (IDEMP_FIRST_EXECUTION), so a crash never leaves one without the other;
 * - live row, same route and request → the stored answer, with nothing run again
 *   (IDEMP_REPLAY_SUCCESS);
 * - live row, other route or request → 409 IDEMP_PAYLOAD_MISMATCH.
 * The row is read `FOR UPDATE`, so a second request with the same key waits for the first and
 * then replays it. Only 2xx answers are stored: a refusal mutated nothing and may be retried.
 *
 * @module
 */
import { createHash } from 'node:crypto';
import type { Transactional, TxQuery } from './db';

/** Syntax of a key (T1.3 F): up to 128 characters, letters, digits and `_ . : -` (UUIDs fit). */
export const IDEMPOTENCY_KEY_SYNTAX = /^[A-Za-z0-9_.:-]{1,128}$/;

/** How long a stored answer is replayed. */
const TTL_MS = 24 * 60 * 60 * 1000;

/** The idempotency header of a request, judged (T1.3 K and F). */
type KeyCheck =
  | { code: 'IDEMP_KEY_ACCEPTED'; key: string }
  | { code: 'IDEMP_KEY_MISSING' | 'IDEMP_KEY_INVALID' };

/**
 * Judges the `Idempotency-Key` header: absent first, then its syntax (T1.3).
 *
 * @param header - The raw header value (string, list or absent).
 * @returns The accepted key, or the code of the refusal.
 */
export function checkIdempotencyKey(header: unknown): KeyCheck {
  if (header === undefined) return { code: 'IDEMP_KEY_MISSING' };
  if (typeof header !== 'string' || !IDEMPOTENCY_KEY_SYNTAX.test(header))
    return { code: 'IDEMP_KEY_INVALID' };
  return { code: 'IDEMP_KEY_ACCEPTED', key: header };
}

/** An answer of a mutation: status and JSON body. */
export interface MutationAnswer {
  /** HTTP status. */
  status: number;
  /** JSON body. */
  body: unknown;
}

/** One idempotent request. */
interface IdempotentRequest {
  /** Who asks: the key is theirs alone. */
  userId: string;
  /** The accepted key. */
  key: string;
  /** Method and route pattern, e.g. `POST /v1/admin/catalog/media`. */
  route: string;
  /** SHA-256 of what was sent (see {@link requestHash}). */
  requestHash: string;
  /** Clock. */
  now: Date;
}

/** What a run gave: the answer to send, and whether it was run or replayed. */
type IdempotentOutcome =
  | {
      code: 'IDEMP_FIRST_EXECUTION' | 'IDEMP_REPLAY_SUCCESS';
      answer: MutationAnswer;
    }
  | { code: 'IDEMP_PAYLOAD_MISMATCH' };

/**
 * The fingerprint of a request: SHA-256 over its type and its bytes.
 *
 * @param contentType - What the body is (e.g. `image/png` or `application/json`).
 * @param body - The bytes, or the parsed JSON (hashed as sent back by JSON.stringify).
 * @returns Lowercase hex digest.
 */
export function requestHash(contentType: string, body: unknown): string {
  return createHash('sha256')
    .update(`${contentType}\n`)
    .update(Buffer.isBuffer(body) ? body : JSON.stringify(body ?? null))
    .digest('hex');
}

const keyHash = (userId: string, key: string) =>
  createHash('sha256').update(`${userId}\n${key}`).digest('hex');

/**
 * Runs a mutation once per key (T2.3a, T2.3d, T2.3e).
 *
 * @param db - Database with transactions.
 * @param request - Who, which key, which route and request, and when.
 * @param work - The mutation; it runs in the same transaction that stores its answer.
 * @returns The answer and whether it ran now or was replayed, or a mismatch.
 */
export function runIdempotent(
  db: Transactional,
  request: IdempotentRequest,
  work: (tx: TxQuery) => Promise<MutationAnswer>
): Promise<IdempotentOutcome> {
  const hash = keyHash(request.userId, request.key);
  return db.transaction(async (tx) => {
    const [row] = await tx.query<{
      route: string;
      request_hash: string;
      response_status: number;
      response_body: string;
      expires_at: Date;
    }>(
      'SELECT route, request_hash, response_status, response_body, expires_at FROM idempotency_keys WHERE key_hash = ? FOR UPDATE',
      [hash]
    );
    if (row && new Date(row.expires_at) > request.now) {
      if (
        row.route !== request.route ||
        row.request_hash !== request.requestHash
      )
        return { code: 'IDEMP_PAYLOAD_MISMATCH' };
      return {
        code: 'IDEMP_REPLAY_SUCCESS',
        answer: {
          status: Number(row.response_status),
          body: JSON.parse(row.response_body) as unknown,
        },
      };
    }
    if (row) {
      await tx.query('DELETE FROM idempotency_keys WHERE key_hash = ?', [hash]);
    }
    const answer = await work(tx);
    if (Math.floor(answer.status / 100) === 2) {
      await tx.query(
        'INSERT INTO idempotency_keys (key_hash, user_id, route, request_hash, response_status, response_headers, response_body, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [
          hash,
          request.userId,
          request.route,
          request.requestHash,
          answer.status,
          '{}',
          JSON.stringify(answer.body),
          new Date(request.now.getTime() + TTL_MS),
        ]
      );
    }
    return { code: 'IDEMP_FIRST_EXECUTION', answer };
  });
}
