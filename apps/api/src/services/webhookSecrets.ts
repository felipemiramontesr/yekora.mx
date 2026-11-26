/**
 * The signing secrets of a webhook while one is being rotated (FC 075 F1, K-75 second part,
 * T1.2): the environment variable may hold a list separated by commas (`new,old`), so events
 * signed with the old secret are still accepted while the processor's dashboard switches over, and
 * no event in flight is refused.
 *
 * @module
 */

/**
 * The secrets of a variable: its elements, trimmed, without the empty ones.
 *
 * @param value - `STRIPE_WEBHOOK_SECRET` or `MP_WEBHOOK_SECRET`.
 * @returns The secrets, the primary first.
 */
export function webhookSecretsOf(value: string): string[] {
  return value
    .split(',')
    .map((secret) => secret.trim())
    .filter((secret) => secret !== '');
}

/**
 * Whether a signature matches any of the secrets. Every secret is tried, whatever the first one
 * says, so the time taken does not tell which of them matched (OWASP A02).
 *
 * @param value - The environment variable with one or more secrets.
 * @param matches - Whether the signature was made with a given secret (compared in constant time).
 * @returns True when at least one secret matches.
 */
export function signedByAny(
  value: string,
  matches: (secret: string) => boolean
): boolean {
  return webhookSecretsOf(value).map(matches).includes(true);
}
