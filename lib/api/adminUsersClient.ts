/**
 * Administrators console client (FC 044 F2): what `/cuenta/administradores` asks
 * `/v1/admin/admins`. Only the owner's session gets an answer; the API decides, this client
 * only carries the request.
 *
 * Every request carries credentials (the session cookie), and every write a fresh
 * `Idempotency-Key`, so a double click or a retried request never applies twice (ADR 0014).
 * Answers are checked against the same schemas the API uses (lib/account/adminUserTypes.ts).
 * Like the other clients it never throws: offline, a timeout, an answer outside the contract or
 * a refusal become a typed reason, the refusal by its machine code (the problem's `detail`).
 *
 * @module
 */
import type { z } from 'zod';
import {
  type adminCreateRequestSchema,
  type adminUpdateRequestSchema,
  adminUserListSchema,
  adminUserSchema,
} from '@/lib/account/adminUserTypes';
import { sessionRequest, type TransportFailure } from './http';

/** Hostinger may wake the API from sleep; the first request pays its start-up. */
const TIMEOUT_MS = 25_000;

/** Refusals the console explains by name. */
const CODES = [
  'OWNER_ROLE_REQUIRED',
  'OWNER_IMMUTABLE',
  'ADMIN_ALREADY_EXISTS',
  'ADMIN_NOT_FOUND',
  'INVALID_REQUEST',
  'SESSION_INVALID_OR_EXPIRED',
] as const;

/** Why a request gave no usable answer. */
export type AdminUsersFailure =
  (typeof CODES)[number] | 'rate_limited' | 'unknown' | TransportFailure;

/** The refusal of an answer, by its machine code or its status. */
function refusal(status: number, body: unknown): AdminUsersFailure {
  if (status === 429) return 'rate_limited';
  const detail = (body as { detail?: unknown } | undefined)?.detail;
  return CODES.find((code) => code === detail) ?? 'unknown';
}

/** One request with the session cookie; a write carries a new Idempotency-Key. */
function request<T>(
  path: string,
  schema: z.ZodType<T>,
  method: 'GET' | 'POST' | 'PATCH',
  body: object | undefined,
  fetchImpl: typeof fetch
) {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body) {
    headers['Idempotency-Key'] = crypto.randomUUID();
    headers['Content-Type'] = 'application/json';
  }
  return sessionRequest(
    fetchImpl,
    path,
    { method, headers, body },
    TIMEOUT_MS,
    schema,
    refusal
  );
}

/**
 * Every owner and administrator account, the owner first.
 *
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The accounts, or why there are none.
 */
export function listAdminUsers(fetchImpl: typeof fetch = fetch) {
  return request(
    '/v1/admin/admins',
    adminUserListSchema,
    'GET',
    undefined,
    fetchImpl
  );
}

/**
 * Invites an administrator: the API creates or promotes the account and mails it a 15-minute
 * link to choose a password. No password is sent or shown (FC 044 T2.2).
 *
 * @param input - E-mail and name.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The account, or why it was refused.
 */
export function inviteAdminUser(
  input: z.input<typeof adminCreateRequestSchema>,
  fetchImpl: typeof fetch = fetch
) {
  return request('/v1/admin/admins', adminUserSchema, 'POST', input, fetchImpl);
}

/**
 * Switches an administrator on or off, or withdraws its role (`revokeAdmin: true`).
 *
 * @param id - The account.
 * @param change - What to change.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The account after the change, or why it was refused.
 */
export function updateAdminUser(
  id: string,
  change: z.input<typeof adminUpdateRequestSchema>,
  fetchImpl: typeof fetch = fetch
) {
  return request(
    `/v1/admin/admins/${id}`,
    adminUserSchema,
    'PATCH',
    change,
    fetchImpl
  );
}
