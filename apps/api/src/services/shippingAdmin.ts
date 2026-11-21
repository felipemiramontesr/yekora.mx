/**
 * The shipping console data (FC 061 F1): what an administrator reads and changes of the rate
 * tables the quote engine prices from (`shipping_configs`, `shipping_rules`, migration 002).
 *
 * - The active strategy and free shipping live in the single row `shipping_configs.id = 1`
 *   (T1.1). A strategy with no active rule would leave every destination unserved, so it is
 *   refused (A04) instead of being saved.
 * - The console edits only `ZONE_RATE` (strategy 2): one rate for each of the 32 states, replaced
 *   as a whole inside the caller's transaction (T1.2). The other four strategies stay readable
 *   catalog entries that this console does not administer.
 * Every write records its `audit_log` entry in the same transaction (T2.3), without personal data.
 *
 * @module
 */
import {
  type ShippingAdminView,
  type ShippingConfigRequest,
  type ShippingRulesRequest,
  ZONE_RATE_STRATEGY_ID,
} from '../../../../lib/account/shippingAdminTypes';
import { recordAudit } from './audit';
import type { TxQuery } from './db';

/** Why a write changed nothing; the route answers with it as the problem's detail. */
export type ShippingRefusal =
  'SHIPPING_STRATEGY_UNAVAILABLE' | 'SHIPPING_ZONE_UNKNOWN';

/** Who acts, for the audit entry. */
interface Actor {
  /** The administrator's user id. */
  userId: string;
  /** Client address. */
  ip: string | null;
}

interface ConfigRow {
  active_strategy_id: number;
  is_free_shipping_active: number;
  free_shipping_threshold_mxn_cents: number | null;
}

interface RuleRow {
  zone_id: number;
  rate_mxn_cents: number;
}

/** The configuration as the console shows it, or the unconfigured default (no row). */
async function readConfig(db: TxQuery): Promise<ShippingAdminView['config']> {
  const [row] = await db.query<ConfigRow>(
    'SELECT active_strategy_id, is_free_shipping_active, free_shipping_threshold_mxn_cents FROM shipping_configs WHERE id = 1'
  );
  return {
    strategyId: row?.active_strategy_id ?? ZONE_RATE_STRATEGY_ID,
    isFreeShippingActive: Number(row?.is_free_shipping_active ?? 0) === 1,
    freeShippingThresholdMxnCents:
      row?.free_shipping_threshold_mxn_cents ?? null,
  };
}

/** The active `ZONE_RATE` rate of each state, the lowest where a state has more than one. */
async function readRules(db: TxQuery): Promise<ShippingAdminView['rules']> {
  const rows = await db.query<RuleRow>(
    `SELECT zone_id, MIN(rate_mxn_cents) AS rate_mxn_cents
     FROM shipping_rules WHERE strategy_id = ? AND is_active = 1 AND zone_id IS NOT NULL
     GROUP BY zone_id ORDER BY zone_id`,
    [ZONE_RATE_STRATEGY_ID]
  );
  return rows.map((row) => ({
    zoneId: row.zone_id,
    rateMxnCents: Number(row.rate_mxn_cents),
  }));
}

/** A reference row with its two names. */
interface NamedRow {
  id: number;
  name_es: string;
  name_en: string;
}

/**
 * Everything the console needs in one read.
 *
 * @param db - Database port, or the transaction of a write.
 * @returns The configuration, the strategies, classes and states, and the rate of each state.
 */
export async function readShippingAdmin(
  db: TxQuery
): Promise<ShippingAdminView> {
  const [config, strategies, classes, zones, rules] = await Promise.all([
    readConfig(db),
    db.query<NamedRow & { code: string }>(
      'SELECT id, code, name_es, name_en FROM shipping_strategies WHERE is_active = 1 ORDER BY id'
    ),
    db.query<NamedRow & { slug: string }>(
      'SELECT id, slug, name_es, name_en FROM shipping_classes WHERE is_active = 1 ORDER BY class_rank'
    ),
    db.query<NamedRow & { code: string }>(
      'SELECT id, code, name_es, name_en FROM shipping_zones WHERE is_active = 1 ORDER BY sort_order'
    ),
    readRules(db),
  ]);
  return {
    config,
    strategies: strategies.map((row) => ({
      id: row.id,
      code: row.code,
      nameEs: row.name_es,
      nameEn: row.name_en,
      administrable: row.id === ZONE_RATE_STRATEGY_ID,
    })),
    classes: classes.map((row) => ({
      id: row.id,
      slug: row.slug,
      nameEs: row.name_es,
      nameEn: row.name_en,
    })),
    zones: zones.map((row) => ({
      id: row.id,
      code: row.code,
      nameEs: row.name_es,
      nameEn: row.name_en,
    })),
    rules,
  };
}

/**
 * Changes the active strategy and the free-shipping modifier (T1.1).
 *
 * @param tx - The caller's transaction.
 * @param body - The validated request.
 * @param actor - Who acts.
 * @returns The view after the change, or why nothing changed.
 */
export async function updateShippingConfig(
  tx: TxQuery,
  body: ShippingConfigRequest,
  actor: Actor
): Promise<ShippingAdminView | ShippingRefusal> {
  const usable = await tx.query<{ id: number }>(
    `SELECT r.id FROM shipping_strategies s
     JOIN shipping_rules r ON r.strategy_id = s.id AND r.is_active = 1
     WHERE s.id = ? AND s.is_active = 1 LIMIT 1`,
    [body.strategyId]
  );
  if (usable.length === 0) return 'SHIPPING_STRATEGY_UNAVAILABLE';
  const before = await readConfig(tx);
  await tx.query(
    `INSERT INTO shipping_configs (id, active_strategy_id, is_free_shipping_active, free_shipping_threshold_mxn_cents)
     VALUES (1, ?, ?, ?)
     ON DUPLICATE KEY UPDATE active_strategy_id = VALUES(active_strategy_id),
       is_free_shipping_active = VALUES(is_free_shipping_active),
       free_shipping_threshold_mxn_cents = VALUES(free_shipping_threshold_mxn_cents)`,
    [
      body.strategyId,
      body.isFreeShippingActive ? 1 : 0,
      body.freeShippingThresholdMxnCents,
    ]
  );
  const view = await readShippingAdmin(tx);
  await recordAudit(tx, {
    userId: actor.userId,
    action: 'SHIPPING_CONFIG_UPDATED',
    entityType: 'shipping_configs',
    entityId: '1',
    before,
    after: view.config,
    ip: actor.ip,
  });
  return view;
}

/**
 * Replaces the rate of every state (T1.2): the old `ZONE_RATE` rules go and the 32 new ones
 * come, in the caller's transaction, so a failure leaves the table as it was.
 *
 * @param tx - The caller's transaction.
 * @param body - The validated request: one rate for each of the 32 states.
 * @param actor - Who acts.
 * @returns The view after the change, or why nothing changed.
 */
export async function updateShippingRules(
  tx: TxQuery,
  body: ShippingRulesRequest,
  actor: Actor
): Promise<ShippingAdminView | ShippingRefusal> {
  const zones = await tx.query<{ id: number }>(
    'SELECT id FROM shipping_zones WHERE is_active = 1'
  );
  const known = new Set(zones.map((zone) => zone.id));
  if (!body.rules.every((rule) => known.has(rule.zoneId))) {
    return 'SHIPPING_ZONE_UNKNOWN';
  }
  const before = await readRules(tx);
  await tx.query('DELETE FROM shipping_rules WHERE strategy_id = ?', [
    ZONE_RATE_STRATEGY_ID,
  ]);
  await Promise.all(
    body.rules.map((rule) =>
      tx.query(
        'INSERT INTO shipping_rules (strategy_id, zone_id, rate_mxn_cents) VALUES (?, ?, ?)',
        [ZONE_RATE_STRATEGY_ID, rule.zoneId, rule.rateMxnCents]
      )
    )
  );
  const view = await readShippingAdmin(tx);
  await recordAudit(tx, {
    userId: actor.userId,
    action: 'SHIPPING_RULES_UPDATED',
    entityType: 'shipping_rules',
    entityId: '*',
    before,
    after: view.rules,
    ip: actor.ip,
  });
  return view;
}
