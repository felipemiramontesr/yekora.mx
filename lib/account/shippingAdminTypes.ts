/**
 * Contract of the shipping console (FC 061, T1.1 and T1.2), shared by the browser and the API
 * (ADR 0008: one set of Zod schemas for both ends): what `/v1/admin/shipping` accepts and
 * answers. It depends on Zod only, so the site bundle can import it.
 *
 * Money is whole MXN cents with VAT included (073_AN); no rate is ever negative.
 *
 * @module
 */
import { z } from 'zod';

/** The strategy this console administers: a rate for each state (`ZONE_RATE`, id 2). */
export const ZONE_RATE_STRATEGY_ID = 2;

/** How many federal entities Mexico has, and so how many rates the matrix holds. */
const STATE_COUNT = 32;

/** The highest rate or threshold the console accepts: 100 000.00 MXN, a typing guard. */
export const MAX_CENTS = 10_000_000;

/** A whole, non-negative amount of cents within the guard. */
const cents = z.number().int().min(0).max(MAX_CENTS);

/** Body of `PUT /v1/admin/shipping/config` (T1.1): the active strategy and free shipping. */
export const shippingConfigRequestSchema = z
  .strictObject({
    strategyId: z.number().int().min(1).max(5),
    isFreeShippingActive: z.boolean(),
    freeShippingThresholdMxnCents: cents.nullable(),
  })
  .refine((body) =>
    body.isFreeShippingActive
      ? body.freeShippingThresholdMxnCents !== null &&
        body.freeShippingThresholdMxnCents > 0
      : body.freeShippingThresholdMxnCents === null
  );

/** One state's rate in the matrix. */
const ruleSchema = z.strictObject({
  zoneId: z.number().int().min(1).max(STATE_COUNT),
  rateMxnCents: cents,
});

/**
 * Body of `PUT /v1/admin/shipping/rules` (T1.2): one rate for each of the 32 states, no state
 * twice and none missing, so the table never leaves a state unserved.
 */
export const shippingRulesRequestSchema = z.strictObject({
  rules: z
    .array(ruleSchema)
    .length(STATE_COUNT)
    .refine(
      (rules) => new Set(rules.map((rule) => rule.zoneId)).size === STATE_COUNT
    ),
});

/** What the console reads: the configuration, the catalogs it chooses from and the matrix. */
export const shippingAdminViewSchema = z.object({
  config: z.object({
    strategyId: z.number().int(),
    isFreeShippingActive: z.boolean(),
    freeShippingThresholdMxnCents: z.number().int().nullable(),
  }),
  strategies: z.array(
    z.object({
      id: z.number().int(),
      code: z.string(),
      nameEs: z.string(),
      nameEn: z.string(),
      /** Whether this console edits the rates of the strategy (only `ZONE_RATE`, FC 061 T1.2). */
      administrable: z.boolean(),
    })
  ),
  classes: z.array(
    z.object({
      id: z.number().int(),
      slug: z.string(),
      nameEs: z.string(),
      nameEn: z.string(),
    })
  ),
  zones: z.array(
    z.object({
      id: z.number().int(),
      code: z.string(),
      nameEs: z.string(),
      nameEn: z.string(),
    })
  ),
  /** The active `ZONE_RATE` rate of each state that has one. */
  rules: z.array(ruleSchema),
});

/** What a console write answers: the view after the change. */
export type ShippingAdminView = z.infer<typeof shippingAdminViewSchema>;

/** The body of a configuration write. */
export type ShippingConfigRequest = z.infer<typeof shippingConfigRequestSchema>;

/** The body of a rates write. */
export type ShippingRulesRequest = z.infer<typeof shippingRulesRequestSchema>;
