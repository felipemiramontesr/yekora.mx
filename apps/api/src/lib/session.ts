/**
 * The session cookie (FC 028 T2.2, ADR 0011 §3): `__Host-yekora_session`, HttpOnly, Secure,
 * SameSite=Strict, Path=/ and no Domain. The `__Host-` prefix makes browsers refuse it unless it
 * is exactly that: tied to apiv1.yekora.mx, unreadable by JavaScript and never sent from another
 * site. Fastify has no cookie plugin here; the one cookie is read and written by hand.
 *
 * @module
 */
import type { SessionUser } from '../services/identity';

/** Name of the session cookie. */
const SESSION_COOKIE = '__Host-yekora_session';

declare module 'fastify' {
  interface FastifyRequest {
    /** The signed-in user, set by the permission guard of a private route (app.ts). */
    user: SessionUser | null;
  }
}

/**
 * The session token in a `Cookie` header.
 *
 * @param header - The request's Cookie header.
 * @returns The token, or null when absent or malformed.
 */
export function readSessionToken(header: string | undefined): string | null {
  for (const part of (header ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_COOKIE) {
      const token = value.join('=');
      return /^[\w-]{43}$/.test(token) ? token : null;
    }
  }
  return null;
}

/**
 * The `Set-Cookie` value that opens a session.
 *
 * @param token - Session token.
 * @param maxAgeSeconds - Lifetime.
 * @returns The header value.
 */
export function sessionCookie(token: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Strict`;
}

/**
 * The `Set-Cookie` value that removes the session cookie.
 *
 * @returns The header value.
 */
export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}
