/**
 * Contract of the payments health probe (FC 070 T2.2): what `GET /v1/admin/payments/health`
 * answers. It names the mode and, for each processor, whether it answered; it never carries a
 * key, a token, an account or any other detail of the processors. Zod only, so it can be shared
 * with the browser (ADR 0008).
 *
 * @module
 */
import { z } from 'zod';

/** What one processor reports: it answered, it did not, or it has no secrets here. */
const processorHealthSchema = z.enum(['ok', 'unreachable', 'unconfigured']);

/** The answer of the probe. `degraded` means a configured processor failed, or none is configured. */
export const paymentsHealthSchema = z.strictObject({
  status: z.enum(['ok', 'degraded']),
  mode: z.enum(['sandbox', 'live']),
  processors: z.strictObject({
    stripe: processorHealthSchema,
    mercadoPago: processorHealthSchema,
  }),
});

/** The answer of the probe, as a type. */
export type PaymentsHealth = z.infer<typeof paymentsHealthSchema>;
