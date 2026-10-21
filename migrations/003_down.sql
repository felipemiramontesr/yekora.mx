-- Rollback of 003 (FC 012 F0). Local use only: scripts/migrateDb.ts --down refuses any host but
-- localhost. Production never rolls back by dropping: it restores the encrypted backup taken
-- before the migration.

ALTER TABLE shipping_configs
  DROP CONSTRAINT IF EXISTS ck_shipping_configs_test,
  DROP COLUMN IF EXISTS is_test;

ALTER TABLE shipping_rules
  DROP CONSTRAINT IF EXISTS ck_shipping_rules_test,
  DROP COLUMN IF EXISTS is_test;

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS ck_products_test,
  DROP CONSTRAINT IF EXISTS ck_products_reserved,
  DROP COLUMN IF EXISTS is_test,
  DROP COLUMN IF EXISTS reserved_stock;

DROP TABLE IF EXISTS payment_events;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS payment_methods;
DROP TABLE IF EXISTS payment_processors;
DROP TABLE IF EXISTS order_statuses;
