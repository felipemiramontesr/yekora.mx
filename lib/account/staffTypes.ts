/**
 * Contract of the panel «Usuarios, roles y permisos» (FC 072 F1, K-78 and K-58), shared by the
 * browser and the API (ADR 0008): what `/v1/admin/users` and `/v1/admin/roles` accept and
 * answer. An account of the staff is shown with {@link adminUserSchema}, the same shape the old
 * console of administrators used. It depends on Zod only, so the site bundle can import it.
 *
 * @module
 */
import { z } from 'zod';

/** A role slug: it names a row of `roles`, never a free text (FC 072 T1.2, letter V). */
const ROLE_ID_PATTERN = /^[a-z][a-z0-9_]{2,30}$/;

/** The slugs of the roles the system owns: a role of support can never take one of them. */
export const RESERVED_ROLE_IDS: ReadonlySet<string> = new Set([
  'owner',
  'admin',
  'customer',
  'staff_orders',
  'staff_catalog',
]);

const roleId = z.string().regex(ROLE_ID_PATTERN);

/** A permission slug as the catalog of the API names it, e.g. `orders:manage`. */
const permissionId = z.string().regex(/^[a-z]+:[a-z]+$/);

/** Body of `POST /v1/admin/users`: who joins the staff and with which roles. No password (T2.4). */
export const staffCreateRequestSchema = z.strictObject({
  email: z.string().trim().pipe(z.email().max(255)),
  fullName: z.string().trim().min(2).max(150),
  roles: z.array(roleId).min(1).max(5),
});

/** Body of `PATCH /v1/admin/users/:id`: switch the account on or off, or replace its roles. */
export const staffUpdateRequestSchema = z
  .strictObject({
    isActive: z.boolean().optional(),
    roles: z.array(roleId).min(1).max(5).optional(),
  })
  .refine((body) => body.isActive !== undefined || body.roles !== undefined);

/** One role with its permissions, as the panel shows it. */
export const roleSchema = z.strictObject({
  id: roleId,
  name: z.string(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  /** A role of the system (owner, customer): the panel never edits it. */
  isSystem: z.boolean(),
  /** Whether an administrator may give it to someone. */
  assignableByAdmin: z.boolean(),
  /** Permission slugs, in alphabetical order. */
  permissions: z.array(permissionId),
});

/** Answer of `GET /v1/admin/roles`: the roles and the catalog of permissions the matrix is made of. */
export const roleListSchema = z.strictObject({
  items: z.array(roleSchema),
  catalog: z.array(permissionId),
});

/** Body of `POST /v1/admin/roles`: a role of support, only the owner creates one. */
export const roleCreateRequestSchema = z.strictObject({
  id: roleId,
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional(),
  permissions: z.array(permissionId).max(40),
  assignableByAdmin: z.boolean().default(true),
});

/** Body of `PATCH /v1/admin/roles/:id`: name, description, state, whether an administrator may give it, and the matrix. */
export const rolePatchRequestSchema = z
  .strictObject({
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().max(500).optional(),
    isActive: z.boolean().optional(),
    assignableByAdmin: z.boolean().optional(),
    permissions: z.array(permissionId).max(40).optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined));

/** Path parameter of one role. */
export const roleParams = z.strictObject({
  id: z.string().regex(ROLE_ID_PATTERN),
});

/** One role with its permissions. */
export type RoleView = z.infer<typeof roleSchema>;
