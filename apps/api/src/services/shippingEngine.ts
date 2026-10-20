/**
 * Shipping engine (FC 011 F1, ADR 0010, Ω decisions in 092_AN §1). Pure: it receives the
 * configuration and rules already read and the facts of one purchase, and never touches the
 * database, so every row of the truth tables is tested without one.
 *
 * Shipping is charged once per purchase, never per product or per unit. With a recognised
 * destination (T1.1 D; the caller rejects the others first):
 *
 *   R  = a configuration exists and an active rule of its strategy covers the purchase
 *        (T1.1). No configuration or no rule → UNSERVICEABLE_DESTINATION: a tariff is never
 *        invented (Ω, option A: nothing is chargeable until real rates are loaded).
 *   T1.2 (only when R holds): FreeShippingGranted ⟺ A ∧ Q, A = the free-shipping modifier is
 *        on, Q = items total with VAT ≥ its threshold → FREE_SHIPPING ($0); else STANDARD_RATE.
 *
 * Rule matching by strategy: FLAT_RATE any rule; ZONE_RATE the destination zone;
 * ZONE_CLASS_RATE the zone and the purchase's class (the highest class_rank present);
 * CHARGEABLE_WEIGHT min ≤ chargeable grams < max; ORDER_TOTAL min ≤ items total < max (max null
 * = no upper bound). Ties: lowest rate, then lowest id (favourable to the buyer, FC 011).
 * Rates are MXN cents with VAT included and split with the product rule (lib/money).
 *
 * @module
 */
import { splitVat } from '../lib/money';

/** Strategy codes of `shipping_strategies` the engine knows. */
type StrategyCode =
  | 'FLAT_RATE'
  | 'ZONE_RATE'
  | 'ZONE_CLASS_RATE'
  | 'CHARGEABLE_WEIGHT'
  | 'ORDER_TOTAL';

/** The Admin's configuration (`shipping_configs` row 1 joined to its strategy). */
export interface ShippingConfig {
  /** Code of the active strategy; an unknown code matches no rule. */
  strategy: string;
  /** Whether the free-shipping modifier is on. */
  freeShippingActive: boolean;
  /** Items total with VAT from which shipping is free; null when the modifier is off. */
  freeShippingThresholdMxnCents: number | null;
}

/** One active rule of the active strategy (`shipping_rules`). */
export interface ShippingRule {
  /** Rule id: second tie-breaker. */
  id: number;
  /** Destination zone, for zone strategies. */
  zoneId: number | null;
  /** Shipping class, for ZONE_CLASS_RATE. */
  classId: number | null;
  /** Inclusive lower bound of the chargeable weight, grams. */
  minWeightGrams: number | null;
  /** Exclusive upper bound of the chargeable weight, grams; null = none. */
  maxWeightGrams: number | null;
  /** Inclusive lower bound of the items total with VAT, cents. */
  minItemsTotalMxnCents: number | null;
  /** Exclusive upper bound of the items total with VAT, cents; null = none. */
  maxItemsTotalMxnCents: number | null;
  /** Charge in MXN cents, VAT included. */
  rateMxnCents: number;
}

/** What the engine needs to know about one purchase. */
interface ShipmentFacts {
  /** Recognised destination zone. */
  zoneId: number;
  /** Shipping class of the purchase (highest rank present); null matches no class rule. */
  classId: number | null;
  /** Chargeable weight of the whole purchase, grams. */
  chargeableGrams: number;
  /** Items total with VAT, cents (what the free-shipping threshold compares). */
  itemsTotalMxnCents: number;
}

/** Outcome of the engine for one purchase. */
export type ShippingOutcome =
  | { serviceable: false; code: 'UNSERVICEABLE_DESTINATION' }
  | {
      serviceable: true;
      /** T1.2 effect. */
      code: 'FREE_SHIPPING' | 'STANDARD_RATE';
      /** Strategy that priced it. */
      strategy: string;
      /** Rule that covered the purchase. */
      ruleId: number;
      /** Charge with VAT, cents (0 when free). */
      totalMxnCents: number;
      /** Base of the charge, cents. */
      baseMxnCents: number;
      /** VAT of the charge, cents. */
      taxMxnCents: number;
      /**
       * Items total with VAT still missing for free shipping: 0 once granted, null while the
       * modifier is off. Lets the cart show progress without knowing the threshold rule.
       */
      freeShippingRemainingMxnCents: number | null;
    };

/** One class and its restriction rank. */
interface ClassRank {
  /** `shipping_classes.id`. */
  id: number;
  /** `shipping_classes.class_rank`: higher = more restrictive. */
  rank: number;
}

/**
 * Shipping class of a purchase: the class with the highest rank among its products, never
 * chosen by name (FC 011, 095 point 3).
 *
 * @param classIds - Class of every product line of the purchase.
 * @param ranks - Every shipping class with its rank.
 * @returns The most restrictive class id, or null when no line has a known class.
 */
export function purchaseClass(
  classIds: readonly number[],
  ranks: readonly ClassRank[]
): number | null {
  let best: ClassRank | null = null;
  for (const rank of ranks) {
    if (
      classIds.includes(rank.id) &&
      (best === null || rank.rank > best.rank)
    ) {
      best = rank;
    }
  }
  return best?.id ?? null;
}

/** Whether `value` lies in [min, max), a null max meaning no upper bound. */
function inRange(
  value: number,
  min: number | null,
  max: number | null
): boolean {
  return min !== null && value >= min && (max === null || value < max);
}

const MATCHERS: Record<
  StrategyCode,
  (rule: ShippingRule, facts: ShipmentFacts) => boolean
> = {
  FLAT_RATE: () => true,
  ZONE_RATE: (rule, facts) => rule.zoneId === facts.zoneId,
  ZONE_CLASS_RATE: (rule, facts) =>
    rule.zoneId === facts.zoneId && rule.classId === facts.classId,
  CHARGEABLE_WEIGHT: (rule, facts) =>
    inRange(facts.chargeableGrams, rule.minWeightGrams, rule.maxWeightGrams),
  ORDER_TOTAL: (rule, facts) =>
    inRange(
      facts.itemsTotalMxnCents,
      rule.minItemsTotalMxnCents,
      rule.maxItemsTotalMxnCents
    ),
};

function isStrategyCode(code: string): code is StrategyCode {
  return Object.hasOwn(MATCHERS, code);
}

/** The covering rule: every rule the strategy matches, cheapest first, then lowest id. */
function coveringRule(
  strategy: string,
  rules: readonly ShippingRule[],
  facts: ShipmentFacts
): ShippingRule | null {
  if (!isStrategyCode(strategy)) return null;
  const matches = MATCHERS[strategy];
  let best: ShippingRule | null = null;
  for (const rule of rules) {
    if (!matches(rule, facts)) continue;
    const cheaper =
      best === null ||
      rule.rateMxnCents < best.rateMxnCents ||
      (rule.rateMxnCents === best.rateMxnCents && rule.id < best.id);
    if (cheaper) best = rule;
  }
  return best;
}

/**
 * Prices the shipment of one purchase with a recognised destination (T1.1 R and T1.2).
 *
 * @param config - Active configuration, or null when the Admin has configured nothing yet.
 * @param rules - Active rules of the configured strategy.
 * @param facts - The purchase.
 * @returns UNSERVICEABLE_DESTINATION without configuration or covering rule; otherwise the
 *   charge with its VAT split, free when the modifier applies.
 */
export function evaluateShipping(
  config: ShippingConfig | null,
  rules: readonly ShippingRule[],
  facts: ShipmentFacts
): ShippingOutcome {
  const rule =
    config === null ? null : coveringRule(config.strategy, rules, facts);
  if (config === null || rule === null) {
    return { serviceable: false, code: 'UNSERVICEABLE_DESTINATION' };
  }
  const threshold = config.freeShippingThresholdMxnCents;
  const free =
    config.freeShippingActive &&
    threshold !== null &&
    facts.itemsTotalMxnCents >= threshold;
  const totalMxnCents = free ? 0 : rule.rateMxnCents;
  const { base, tax } = splitVat(totalMxnCents);
  const remaining =
    config.freeShippingActive && threshold !== null
      ? Math.max(threshold - facts.itemsTotalMxnCents, 0)
      : null;
  return {
    serviceable: true,
    code: free ? 'FREE_SHIPPING' : 'STANDARD_RATE',
    strategy: config.strategy,
    ruleId: rule.id,
    totalMxnCents,
    baseMxnCents: base,
    taxMxnCents: tax,
    freeShippingRemainingMxnCents: remaining,
  };
}
