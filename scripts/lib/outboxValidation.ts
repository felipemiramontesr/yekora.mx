/**
 * Rules of ADR 0013 (FC 027 T2.5): mail leaves only through the outbox. No module may import
 * an SMTP client except the dispatcher, and no HTTP route may import the dispatcher, so a request
 * can never open an SMTP socket. The dispatcher retries with capped exponential backoff.
 *
 * scripts/checkPlatformGuards.ts applies the import rule to apps/api/src. Until FC 028 adds the
 * dispatcher there is no SMTP client at all, and the rule guards exactly that.
 *
 * @module
 */

/** The only module allowed to talk SMTP (FC 028). */
export const OUTBOX_DISPATCHER = 'apps/api/src/services/outboxDispatcher.ts';

/** Modules that open SMTP connections. */
const SMTP_CLIENTS = ['nodemailer', 'smtp-client', 'emailjs'];

/** Directory of the HTTP route handlers. */
const ROUTES_DIR = 'apps/api/src/routes/';

/** Every module a source file imports or requires. */
function importedModules(source: string): string[] {
  // `from 'x'`, `import 'x'`, `import('x')` and `require('x')`: a keyword, then only spaces or
  // an opening parenthesis, then the quoted module.
  const pattern = /\b(?:from|import|require)[\s(]*['"]([^'"\n]+)['"]/g;
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

/**
 * Finds every file that could send mail outside the outbox.
 *
 * @param files - Source files by repository path (forward slashes).
 * @returns One message per forbidden import; empty when mail can only leave through the outbox.
 */
export function outboxViolations(files: ReadonlyMap<string, string>): string[] {
  const violations: string[] = [];
  for (const [path, source] of files) {
    if (path.endsWith('.test.ts')) continue;
    for (const module of importedModules(source)) {
      const isSmtp = SMTP_CLIENTS.some(
        (client) => module === client || module.startsWith(`${client}/`)
      );
      if (isSmtp && path !== OUTBOX_DISPATCHER)
        violations.push(
          `${path} imports the SMTP client ${module} (only the outbox dispatcher may)`
        );
      if (path.startsWith(ROUTES_DIR) && module.endsWith('outboxDispatcher'))
        violations.push(
          `${path} imports the outbox dispatcher (a route only enqueues)`
        );
    }
  }
  return violations;
}

/**
 * Wait before the next attempt of a failed message: doubling from `baseSeconds`, capped.
 *
 * @param attempt - Attempts already made (1 after the first failure).
 * @param baseSeconds - Wait after the first failure.
 * @param capSeconds - Longest wait.
 * @returns Seconds until `next_retry_at`.
 */
export function retryDelaySeconds(
  attempt: number,
  baseSeconds = 30,
  capSeconds = 3600
): number {
  return Math.min(capSeconds, baseSeconds * 2 ** Math.max(0, attempt - 1));
}
