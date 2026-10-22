-- FC 015 F0 · Verification counters of migration 002 (shipping engine, FC 011).
-- Aggregates only, never data rows; read-only. Run by scripts/migrateDb.ts after 002 is applied
-- or found registered. Not a migration (does not match MIGRATION_NAME).
-- Expected after 002: shipping_classes 2, strategies 5, zones 32; rules and configuration are
-- live counts (002 seeds none, Ω decision).
SELECT
  (SELECT COUNT(*) FROM shipping_classes WHERE slug IN ('estandar', 'voluminoso')) AS shipping_classes,
  (SELECT COUNT(*) FROM shipping_strategies WHERE id BETWEEN 1 AND 5) AS strategies,
  (SELECT COUNT(*) FROM shipping_zones) AS zones,
  (SELECT COUNT(*) FROM shipping_rules) AS rules,
  (SELECT COUNT(*) FROM shipping_configs) AS configs;
