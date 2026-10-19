/**
 * RFC 7807 problem details (FC 008, ADR 0006 R5): every error leaves the API as
 * `application/problem+json` with a status, a short title and an optional detail. Never a stack
 * trace, an SQL message or a server path (OWASP A05).
 *
 * @module
 */

/** Body of an RFC 7807 response. */
interface Problem {
  /** Problem type; `about:blank` means "see the status". */
  type: string;
  /** Short, human-readable summary. */
  title: string;
  /** HTTP status code. */
  status: number;
  /** Optional explanation safe to show to clients. */
  detail?: string;
}

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
