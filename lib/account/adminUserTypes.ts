/**
 * An account of the staff as the panel «Usuarios, roles y permisos» shows it (FC 044 F1, FC 072),
 * shared by the browser and the API (ADR 0008: one set of Zod schemas for both ends): what
 * `/v1/admin/users` answers. What the routes accept is in lib/account/staffTypes.ts. It depends on
 * Zod only, so the site bundle can import it.
 *
 * @module
 */
import { z } from 'zod';

/** Path parameter of one account. */
export const adminUserParams = z.object({ id: z.uuid() });

/** One account of the staff, as the panel shows it. */
export const adminUserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  fullName: z.string(),
  /** Role slugs, in alphabetical order. An `owner` here is protected: no route changes it. */
  roles: z.array(z.string()),
  isActive: z.boolean(),
  /** Whether the authenticator is on; until then the account cannot use the panel. */
  totpEnabled: z.boolean(),
  /** ISO 8601, UTC. */
  createdAt: z.iso.datetime(),
});

/** Answer of `GET /v1/admin/users`: owners first, then administrators, then the rest of the staff by e-mail. */
export const adminUserListSchema = z.object({
  items: z.array(adminUserSchema),
});

/** One account of the staff. */
export type AdminUser = z.infer<typeof adminUserSchema>;
