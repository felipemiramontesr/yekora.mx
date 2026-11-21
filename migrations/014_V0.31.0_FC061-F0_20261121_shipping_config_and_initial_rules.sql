-- 014 · V0.31.0 · FC 061 F0 · 2026-11-21 · Shipping configuration and a rate for each of the 32 states.
--
-- Until now no configuration and no rate were seeded (migration 002, Ω option A: inventing a
-- tariff was forbidden), so every destination quoted UNSERVICEABLE_DESTINATION and a clean
-- deployment could not complete a single order with shipping. Ω signed FC 061 to open sale all
-- over Mexico: this migration seeds the canonical configuration row (id = 1, strategy ZONE_RATE
-- = 2, free shipping off) and one provisional rate of 150.00 MXN (15 000 cents, VAT included) for
-- each active state. The rates are a fallback the shipping console (`{area}envios/`) edits, and
-- the base DHL (K-90) will fall back to.
--
-- It never overwrites what is already there: the configuration row is inserted only if absent and
-- a state that already has an active ZONE_RATE rule keeps it (production holds rows loaded by
-- hand for the test purchase).
--
-- It also opens the permission `shipping:manage` and gives it to `owner` and `admin`. Those two
-- roles got the union of the catalog by construction in 004 and 008, which ran before this
-- permission existed, so the grant is written here for both.
--
-- Idempotent (DB_LAW): INSERT IGNORE on the keys and INSERT … SELECT … WHERE NOT EXISTS for the
-- rules, so a second run changes nothing.

INSERT IGNORE INTO shipping_configs (id, active_strategy_id, is_free_shipping_active, free_shipping_threshold_mxn_cents)
VALUES (1, 2, 0, NULL);

INSERT INTO shipping_rules (strategy_id, zone_id, rate_mxn_cents)
  SELECT 2, z.id, 15000
  FROM shipping_zones z
  WHERE z.is_active = 1
    AND NOT EXISTS (
      SELECT 1 FROM shipping_rules r
      WHERE r.strategy_id = 2 AND r.zone_id = z.id AND r.is_active = 1
    );

INSERT IGNORE INTO permissions (id, module, description) VALUES
  ('shipping:manage', 'shipping', 'Consultar y editar la estrategia de envío, el envío gratis y la tarifa de cada estado.');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
  SELECT r.id, 'shipping:manage' FROM roles r WHERE r.id IN ('owner', 'admin');
