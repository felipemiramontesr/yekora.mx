/**
 * The cookies of the API (FC 028 T2.2, ADR 0011 §3), all HttpOnly, Secure, SameSite=Strict,
 * Path=/ and without Domain. The `__Host-` prefix makes browsers refuse them unless they are
 * exactly that: tied to apiv1.yekora.mx, unreadable by JavaScript and never sent from another
 * site. Fastify has no cookie plugin here; they are read and written by hand.
 *
 * - `__Host-yekora_session`: the session (2 h for staff, 8 h for buyers).
 * - `__Host-yekora_device`: a buyer's trusted device, 30 days (Enmienda 1, T2.9c).
 *
 * @module
 */
import type { SessionUser } from '../services/identity';
import { DEVICE_SECONDS } from '../services/trustedDevices';

/** Name of the session cookie. */
const SESSION_COOKIE = '__Host-yekora_session';
/** Name of the trusted-device cookie. */
const DEVICE_COOKIE = '__Host-yekora_device';
/** Flags every cookie of the API carries, after its Path and Max-Age. */
const FLAGS = 'HttpOnly; Secure; SameSite=Strict';

/** One `Set-Cookie` value of the API. */
const cookie = (name: string, value: string, maxAgeSeconds: number) =>
  `${name}=${value}; Path=/; Max-Age=${maxAgeSeconds}; ${FLAGS}`;

declare module 'fastify' {
  interface FastifyRequest {
    /** The signed-in user, set by the permission guard of a private route (app.ts). */
    user: SessionUser | null;
  }
}

/** A 256-bit token (43 base64url characters) of one cookie, or null. */
function readToken(header: string | undefined, wanted: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === wanted) {
      const token = value.join('=');
      return /^[\w-]{43}$/.test(token) ? token : null;
    }
  }
  return null;
}

/**
 * The session token in a `Cookie` header.
 *
 * @param header - The request's Cookie header.
 * @returns The token, or null when absent or malformed.
 */
export function readSessionToken(header: string | undefined): string | null {
  return readToken(header, SESSION_COOKIE);
}

/**
 * The trusted-device token in a `Cookie` header.
 *
 * @param header - The request's Cookie header.
 * @returns The token, or null when absent or malformed.
 */
export function readDeviceToken(header: string | undefined): string | null {
  return readToken(header, DEVICE_COOKIE);
}

/**
 * The `Set-Cookie` value that opens a session.
 *
 * @param token - Session token.
 * @param maxAgeSeconds - Lifetime.
 * @returns The header value.
 */
export function sessionCookie(token: string, maxAgeSeconds: number): string {
  return cookie(SESSION_COOKIE, token, maxAgeSeconds);
}

/**
 * The `Set-Cookie` value that removes the session cookie.
 *
 * @returns The header value.
 */
export function clearedSessionCookie(): string {
  return cookie(SESSION_COOKIE, '', 0);
}

/**
 * The `Set-Cookie` value that remembers a device for 30 days (T2.9c).
 *
 * @param token - Device token.
 * @returns The header value.
 */
export function deviceCookie(token: string): string {
  return cookie(DEVICE_COOKIE, token, DEVICE_SECONDS);
}

/**
 * The `Set-Cookie` value that removes the device cookie (T2.9d).
 *
 * @returns The header value.
 */
export function clearedDeviceCookie(): string {
  return cookie(DEVICE_COOKIE, '', 0);
}
