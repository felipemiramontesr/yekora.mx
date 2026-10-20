-- Rollback of 002 (FC 011 F0). Local use only: scripts/migrateDb.ts --down refuses any host but
-- localhost. Removes the physical columns from products, then drops the shipping tables in
-- reverse dependency order; the migrator then removes 002 from schema_migrations. Production
-- never rolls back by dropping: it restores the encrypted backup taken before the migration.

ALTER TABLE products
  DROP FOREIGN KEY IF EXISTS fk_products_shipping_class,
  DROP CONSTRAINT IF EXISTS ck_products_physical_positive,
  DROP COLUMN IF EXISTS shipping_class_id,
  DROP COLUMN IF EXISTS height_mm,
  DROP COLUMN IF EXISTS width_mm,
  DROP COLUMN IF EXISTS length_mm,
  DROP COLUMN IF EXISTS weight_grams;

DROP TABLE IF EXISTS shipping_rules;
DROP TABLE IF EXISTS shipping_configs;
DROP TABLE IF EXISTS shipping_strategies;
DROP TABLE IF EXISTS shipping_zones;
DROP TABLE IF EXISTS shipping_classes;
