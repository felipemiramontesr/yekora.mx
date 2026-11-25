/**
 * Client of the panel «Usuarios, roles y permisos» (FC 072 F2): what `/cuenta/usuarios` asks
 * `/v1/admin/users` and `/v1/admin/roles`. The owner's and the administrator's sessions get an
 * answer; the API decides by the hierarchy, this client only carries the request.
 *
 * Every request carries credentials (the session cookie), and every write a fresh
 * `Idempotency-Key`, so a double click or a retried request never applies twice (ADR 0014).
 * Answers are checked against the same schemas the API uses (lib/account/adminUserTypes.ts and
 * lib/account/staffTypes.ts). Like the other clients it never throws: offline, a timeout, an
 * answer outside the contract or a refusal become a typed reason, the refusal by its machine code
 * (the problem's `detail`).
 *
 * @module
 */
import type { z } from 'zod';
import {
  adminUserListSchema,
  adminUserSchema,
} from '@/lib/account/adminUserTypes';
import {
  roleListSchema,
  type staffCreateRequestSchema,
  type staffUpdateRequestSchema,
} from '@/lib/account/staffTypes';
import { sessionRequest, type TransportFailure } from './http';

/** Hostinger may wake the API from sleep; the first request pays its start-up. */
const TIMEOUT_MS = 25_000;

/** Refusals the panel explains by name. */
const CODES = [
  'ACTOR_UNAUTHORIZED',
  'TARGET_ROLE_FORBIDDEN',
  'ADMIN_CANNOT_ELEVATE_ADMIN',
  'OWNER_IMMUTABLE',
  'VALIDATION_OR_2FA_FAILED',
  'USER_NOT_FOUND',
  'ROLE_NOT_FOUND',
  'STAFF_ALREADY_EXISTS',
  'INVALID_REQUEST',
  'SESSION_INVALID_OR_EXPIRED',
] as const;

/** Why a request gave no usable answer. */
export type StaffFailure =
  (typeof CODES)[number] | 'rate_limited' | 'unknown' | TransportFailure;

/** The refusal of an answer, by its machine code or its status. */
function refusal(status: number, body: unknown): StaffFailure {
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
 * The staff the session may see: all of it for the owner, the sellers and support roles for an
 * administrator.
 *
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The accounts, or why there are none.
 */
export function listStaffUsers(fetchImpl: typeof fetch = fetch) {
  return request(
    '/v1/admin/users',
    adminUserListSchema,
    'GET',
    undefined,
    fetchImpl
  );
}

/**
 * The roles with their permissions, which the panel names and offers when it gives roles.
 *
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The roles and the catalog of permissions, or why there are none.
 */
export function listStaffRoles(fetchImpl: typeof fetch = fetch) {
  return request(
    '/v1/admin/roles',
    roleListSchema,
    'GET',
    undefined,
    fetchImpl
  );
}

/**
 * Brings a person into the staff: the API creates or promotes the account and mails it a
 * 15-minute link to choose a password. No password is sent or shown (FC 072 T2.4).
 *
 * @param input - E-mail, name and roles.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The account, or why it was refused.
 */
export function inviteStaffUser(
  input: z.input<typeof staffCreateRequestSchema>,
  fetchImpl: typeof fetch = fetch
) {
  return request('/v1/admin/users', adminUserSchema, 'POST', input, fetchImpl);
}

/**
 * Switches an account of the staff on or off, or replaces its roles.
 *
 * @param id - The account.
 * @param change - What to change.
 * @param fetchImpl - `fetch`, injectable for tests.
 * @returns The account after the change, or why it was refused.
 */
export function updateStaffUser(
  id: string,
  change: z.input<typeof staffUpdateRequestSchema>,
  fetchImpl: typeof fetch = fetch
) {
  return request(
    `/v1/admin/users/${id}`,
    adminUserSchema,
    'PATCH',
    change,
    fetchImpl
  );
}
