/**
 * The security of the account (FC 079, K-64c): the change of password from a session, the open
 * sessions and the remembered devices. One set of Zod schemas for the browser and the API
 * (ADR 0008). A session is named by the hash of its token: it tells one apart without letting
 * anyone rebuild the cookie.
 *
 * @module
 */
import { z } from 'zod';

const password = z.string().min(1).max(200);

/** Body of `POST /v1/account/password`. */
export const passwordChangeRequestSchema = z.strictObject({
  currentPassword: password,
  newPassword: password,
  confirmPassword: password,
});

/** What a write of this section answers when it applied. */
export const securityDoneSchema = z.object({ success: z.literal(true) });

/** Where a session or a device was opened from, and since when. */
const origin = {
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string(),
};

/** Answer of `GET /v1/account/sessions`, newest first. */
export const sessionListSchema = z.object({
  items: z.array(
    z.object({ id: z.string(), isCurrent: z.boolean(), ...origin })
  ),
});

/** Answer of `GET /v1/account/devices`, newest first. */
export const deviceListSchema = z.object({
  items: z.array(
    z.object({ id: z.number().int(), expiresAt: z.string(), ...origin })
  ),
});

/** Path parameter of one session: the SHA-256 of its token. */
export const sessionParams = z.strictObject({
  id: z.string().regex(/^[0-9a-f]{64}$/),
});

/** Path parameter of one remembered device. */
export const deviceParams = z.strictObject({
  id: z.coerce.number().int().min(1),
});
