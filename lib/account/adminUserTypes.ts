/**
 * Contract of the administrators console (FC 044 F1, T1.2 to T1.4), shared by the browser and
 * the API (ADR 0008: one set of Zod schemas for both ends): what `/v1/admin/admins` accepts and
 * answers. Only the owner calls these routes. It depends on Zod only, so the site bundle can
 * import it.
 *
 * @module
 */
import { z } from 'zod';

/** Body of `POST /v1/admin/admins`: who becomes an administrator. No password travels (T2.2). */
export const adminCreateRequestSchema = z.strictObject({
  email: z.string().trim().pipe(z.email().max(255)),
  fullName: z.string().trim().min(2).max(150),
});

/**
 * Body of `PATCH /v1/admin/admins/:id`: switch the account on or off, or withdraw its `admin`
 * role. At least one of the two.
 */
export const adminUpdateRequestSchema = z
  .strictObject({
    isActive: z.boolean().optional(),
    revokeAdmin: z.boolean().optional(),
  })
  .refine(
    (body) => body.isActive !== undefined || body.revokeAdmin !== undefined
  );

/** Path parameter of one account. */
export const adminUserParams = z.object({ id: z.uuid() });

/** One owner or administrator account, as the console shows it. */
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

/** Answer of `GET /v1/admin/admins`: owners first, then administrators by e-mail. */
export const adminUserListSchema = z.object({
  items: z.array(adminUserSchema),
});

/** One owner or administrator account. */
export type AdminUser = z.infer<typeof adminUserSchema>;
