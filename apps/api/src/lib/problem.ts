/**
 * RFC 7807 problem details (FC 008, ADR 0006 R5): every error leaves the API as
 * `application/problem+json` with a status, a short title and an optional detail. Never a stack
 * trace, an SQL message or a server path (OWASP A05).
 *
 * FC 027: the schema of that body is part of the API contract (contract.ts, apps/api/openapi.json).
 *
 * @module
 */
import { z } from 'zod';

/** Body of an RFC 7807 response; also the error answer of the API contract. */
export const problemSchema = z.object({
  /** Problem type; `about:blank` means "see the status". */
  type: z.string(),
  /** Short, human-readable summary. */
  title: z.string(),
  /** HTTP status code. */
  status: z.number().int(),
  /** Optional explanation safe to show to clients. */
  detail: z.string().optional(),
});

/** Body of an RFC 7807 response. */
type Problem = z.infer<typeof problemSchema>;

/** Content type of every error response. */
export const PROBLEM_TYPE = 'application/problem+json';

/**
 * Builds a problem body.
 *
 * @param status - HTTP status code.
 * @param title - Short summary.
 * @param detail - Optional client-safe explanation.
 * @returns The RFC 7807 body.
 */
export function problem(
  status: number,
  title: string,
  detail?: string
): Problem {
  return detail === undefined
    ? { type: 'about:blank', title, status }
    : { type: 'about:blank', title, status, detail };
}
