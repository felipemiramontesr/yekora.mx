/**
 * Breached-password check (FC 042 Enmienda 2, T1.2, T2.6): the k-anonymity range of Have I Been
 * Pwned's Pwned Passwords, free and keyless.
 *
 * Only the first 5 hex characters of the password's SHA-1 leave the server; the answer lists every
 * suffix of that range with how often it was seen, and the match is made here. SHA-1 is what the
 * range protocol is keyed by, not a protection of anything: no SHA-1 is stored or sent whole. It
 * is computed with hash-wasm, the library of the Argon2id hashes (decision of Ω, 2026-11-09).
 *
 * SSRF-safe by construction (OWASP A10): the URL is a constant on HIBP's host and the only part
 * that varies is the 5-character hex prefix. `Add-Padding` makes every answer the same size, so
 * its length tells an observer nothing about the range. Nothing of the call is logged.
 *
 * Fail-open, as Ω accepted the risk: no answer within {@link PWNED_TIMEOUT_MS}, a status other
 * than 200, or a 200 whose body is not a non-empty list of `SUFFIX35HEX:COUNT` lines all read as
 * `unknown`, never as `clear`, and the route then relies on the 7 local rules alone.
 *
 * @module
 */
import { sha1 } from 'hash-wasm';

/** The only endpoint this module may contact; the 5-character prefix is appended. */
const RANGE_URL = 'https://api.pwnedpasswords.com/range/';
/** How long the range may take before the check gives up (T2.6: at most 1500 ms). */
const PWNED_TIMEOUT_MS = 1500;
/** One line of a range: the other 35 hex characters of a SHA-1 and how often it was seen. */
const RANGE_LINE = /^[0-9A-F]{35}:\d+$/i;

/**
 * What the range says of a password: seen in a breach, not seen in a valid range, or no valid
 * range to judge by (fail-open).
 */
export type BreachVerdict = 'breached' | 'clear' | 'unknown';

/** The non-empty lines of a range body, or null when any of them is not `SUFFIX35HEX:COUNT`. */
function rangeLines(body: string): string[] | null {
  const lines = body.split(/\r?\n/).filter((line) => line !== '');
  if (lines.length === 0) return null;
  return lines.every((line) => RANGE_LINE.test(line)) ? lines : null;
}

/**
 * Asks the Pwned Passwords range whether a password has been seen in a breach.
 *
 * @param password - The new password, as typed; it never leaves this function.
 * @param fetchImpl - `fetch`, injectable for tests (CI never reaches the network).
 * @param timeoutMs - Give up after this many milliseconds.
 * @returns `breached` when its suffix is listed with a count above zero, `clear` when a valid
 *   range does not list it, and `unknown` on a timeout, a non-200 status, a malformed body or
 *   any network failure.
 */
export async function breachVerdict(
  password: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = PWNED_TIMEOUT_MS
): Promise<BreachVerdict> {
  const digest = (await sha1(password)).toUpperCase();
  const suffix = digest.slice(5);
  try {
    const answer = await fetchImpl(`${RANGE_URL}${digest.slice(0, 5)}`, {
      headers: { 'Add-Padding': 'true' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (answer.status !== 200) return 'unknown';
    const lines = rangeLines(await answer.text());
    if (lines === null) return 'unknown';
    const seen = lines.some((line) => {
      const [listed, count] = line.split(':');
      return listed.toUpperCase() === suffix && Number(count) > 0;
    });
    return seen ? 'breached' : 'clear';
  } catch {
    // Timeout, DNS, TLS or a reset connection: no range to judge by.
    return 'unknown';
  }
}
