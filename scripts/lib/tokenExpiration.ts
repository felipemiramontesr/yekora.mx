/**
 * Expiry watch of SECURITY_AUTOFIX_TOKEN (FC 038, K-53): the token that lets the daily audit
 * (FC 036) and Dependabot (FC 037) merge patches lives 90 days, and GitHub only warns its owner a
 * few days before. Every day the CLI (scripts/checkTokenExpiration.ts) calls the API with the
 * token and reads `github-authentication-token-expiration`; this module decides what that means.
 *
 * Fail-closed: a 401, a missing header or a date it cannot read is an alert, never silence.
 * One issue per alert: created once, commented on every later run, and closed by the first run
 * that sees the rotated token more than 15 days from expiry. Pure: no network, no clock.
 *
 * @module
 */

/** Days before expiry when the alert opens. */
export const ALERT_DAYS = 15;

/** Title of the one alert issue; the CLI finds it by this exact title. */
export const ALERT_TITLE =
  '[SECURITY] SECURITY_AUTOFIX_TOKEN expira en menos de 15 días';

/** What the token's answer means. */
export type TokenStatus =
  | { state: 'ok'; expiresAt: Date; daysLeft: number }
  | { state: 'expiring'; expiresAt: Date; daysLeft: number }
  | { state: 'broken'; reason: string };

/** What to do with the alert issue on this run. */
export type AlertAction = 'create' | 'comment' | 'close' | 'none';

const MS_PER_DAY = 86_400_000;

/**
 * Reads the expiry header (`2027-01-31 06:00:00 UTC` or `2027-01-31 00:00:00 -0600`).
 *
 * @param header - Value of `github-authentication-token-expiration`, or null when absent.
 * @returns The instant it expires, or null when absent or unreadable.
 */
export function parseExpiration(header: string | null): Date | null {
  const match =
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) (UTC|[+-]\d{4})$/.exec(
      header?.trim() ?? ''
    );
  if (match === null) return null;
  const [, day, time, zone] = match;
  const offset = zone === 'UTC' ? 'Z' : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const instant = new Date(`${day}T${time}${offset}`);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/**
 * Judges one authenticated call made with the token (T1.1).
 *
 * @param answer - HTTP status and expiry header of the call (status 0 when there is no token).
 * @param now - The run's clock.
 * @returns ok, expiring (≤ 15 whole days left) or broken, with the reason.
 */
export function judgeToken(
  answer: { status: number; expiration: string | null },
  now: Date
): TokenStatus {
  if (answer.status === 0)
    return { state: 'broken', reason: 'el secreto no está configurado' };
  if (answer.status === 401)
    return {
      state: 'broken',
      reason: 'GitHub lo rechaza (401): vencido, revocado o borrado',
    };
  if (answer.status !== 200)
    return {
      state: 'broken',
      reason: `GitHub respondió ${answer.status}`,
    };
  const expiresAt = parseExpiration(answer.expiration);
  if (expiresAt === null)
    return {
      state: 'broken',
      reason: 'GitHub no informó una fecha de vencimiento legible',
    };
  const daysLeft = Math.floor(
    (expiresAt.getTime() - now.getTime()) / MS_PER_DAY
  );
  return {
    state: daysLeft <= ALERT_DAYS ? 'expiring' : 'ok',
    expiresAt,
    daysLeft,
  };
}

/**
 * Decides the alert issue's fate (T1.2): one issue per alert, never a duplicate.
 *
 * @param status - Verdict of {@link judgeToken}.
 * @param openIssue - Number of the open alert issue, or null when there is none.
 * @returns create (alert, no issue), comment (alert, issue open), close (healthy, issue open)
 *   or none (healthy, no issue).
 */
export function alertAction(
  status: TokenStatus,
  openIssue: number | null
): AlertAction {
  const alert = status.state !== 'ok';
  if (alert) return openIssue === null ? 'create' : 'comment';
  return openIssue === null ? 'none' : 'close';
}

/**
 * Text of the issue body, the follow-up comment or the closing note.
 *
 * @param status - Verdict of {@link judgeToken}.
 * @returns Spanish text for GrayMan, with what to do.
 */
export function alertText(status: TokenStatus): string {
  if (status.state === 'ok') {
    return `El token ya fue renovado: vence el ${status.expiresAt.toISOString().slice(0, 10)} (faltan ${status.daysLeft} días). Cierre automático (FC 038).`;
  }
  const what =
    status.state === 'broken'
      ? `SECURITY_AUTOFIX_TOKEN no sirve: ${status.reason}.`
      : `SECURITY_AUTOFIX_TOKEN vence el ${status.expiresAt.toISOString().slice(0, 10)} (faltan ${status.daysLeft} días).`;
  return [
    what,
    '',
    'Sin él, la auditoría diaria (FC 036) y Dependabot (FC 037) no pueden integrar parches de seguridad.',
    'Renovarlo: GitHub → Settings → Developer settings → Fine-grained tokens → yekora-security-autofix → Regenerate (90 días),',
    'y guardar el valor nuevo en yekora.mx → Settings → Secrets and variables → Actions **y** → Dependabot, con el nombre SECURITY_AUTOFIX_TOKEN.',
    'Procedimiento: docs/security/dependency-triage.md §7. Este aviso se cierra solo cuando el token nuevo tenga más de 15 días por delante.',
  ].join('\n');
}
