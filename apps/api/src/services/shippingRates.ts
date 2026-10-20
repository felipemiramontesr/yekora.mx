/**
 * Internal rate tables adapter (FC 011 F1, `InternalTableRateAdapter` of ADR 0010): reads the
 * Admin's configuration and rules from MariaDB (migration 002) and lets the pure engine price
 * the purchase. Static SQL with `?` placeholders only (ADR 0003, checkNoRawSql).
 *
 * Order of evaluation, one query at a time and only as far as needed:
 * 1. the destination state must be an active zone, else INVALID_DESTINATION (T1.1 D);
 * 2. no configuration row → UNSERVICEABLE_DESTINATION (nothing configured, Ω option A);
 * 3. the engine prices the purchase with the active rules of the configured strategy.
 *
 * @module
 */
import type { Db } from './db';
import { purchaseWeight } from './dimensioning';
import {
  evaluateShipping,
  purchaseClass,
  type ShippingConfig,
  type ShippingRule,
} from './shippingEngine';
import type {
  ShipmentQuote,
  ShipmentRequest,
  ShippingRateProvider,
} from './shippingPort';

interface ConfigRow {
  strategy_id: number;
  strategy: string;
  is_free_shipping_active: number;
  free_shipping_threshold_mxn_cents: number | null;
}

interface RuleRow {
  id: number;
  zone_id: number | null;
  shipping_class_id: number | null;
  min_weight_grams: number | null;
  max_weight_grams: number | null;
  min_items_total_mxn_cents: number | null;
  max_items_total_mxn_cents: number | null;
  rate_mxn_cents: number;
}

function toRule(row: RuleRow): ShippingRule {
  return {
    id: row.id,
    zoneId: row.zone_id,
    classId: row.shipping_class_id,
    minWeightGrams: row.min_weight_grams,
    maxWeightGrams: row.max_weight_grams,
    minItemsTotalMxnCents: row.min_items_total_mxn_cents,
    maxItemsTotalMxnCents: row.max_items_total_mxn_cents,
    rateMxnCents: row.rate_mxn_cents,
  };
}

/**
 * The v1 provider, backed by the rate tables of MariaDB.
 *
 * @param db - Database port.
 * @returns A {@link ShippingRateProvider} that never calls the network.
 */
export function createTableRateProvider(db: Db): ShippingRateProvider {
  return {
    async quote(request: ShipmentRequest): Promise<ShipmentQuote> {
      const [zone] = await db.query<{ id: number }>(
        'SELECT id FROM shipping_zones WHERE code = ? AND is_active = 1',
        [request.stateCode]
      );
      if (zone === undefined)
        return { serviceable: false, code: 'INVALID_DESTINATION' };

      const [row] = await db.query<ConfigRow>(
        `SELECT s.id AS strategy_id, s.code AS strategy, c.is_free_shipping_active,
           c.free_shipping_threshold_mxn_cents
         FROM shipping_configs c
         JOIN shipping_strategies s ON s.id = c.active_strategy_id
         WHERE c.id = 1 AND s.is_active = 1`
      );
      if (row === undefined) {
        return { serviceable: false, code: 'UNSERVICEABLE_DESTINATION' };
      }
      const config: ShippingConfig = {
        strategy: row.strategy,
        freeShippingActive: row.is_free_shipping_active === 1,
        freeShippingThresholdMxnCents: row.free_shipping_threshold_mxn_cents,
      };
      const [classes, rules] = await Promise.all([
        db.query<{ id: number; class_rank: number }>(
          'SELECT id, class_rank FROM shipping_classes'
        ),
        db.query<RuleRow>(
          `SELECT id, zone_id, shipping_class_id, min_weight_grams, max_weight_grams,
             min_items_total_mxn_cents, max_items_total_mxn_cents, rate_mxn_cents
           FROM shipping_rules WHERE strategy_id = ? AND is_active = 1`,
          [row.strategy_id]
        ),
      ]);
      return evaluateShipping(config, rules.map(toRule), {
        zoneId: zone.id,
        classId: purchaseClass(
          request.lines.map((line) => line.classId),
          classes.map((c) => ({ id: c.id, rank: c.class_rank }))
        ),
        chargeableGrams: purchaseWeight(request.lines).chargeableGrams,
        itemsTotalMxnCents: request.itemsTotalMxnCents,
      });
    },
  };
}
