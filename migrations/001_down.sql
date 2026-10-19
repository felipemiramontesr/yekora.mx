-- Rollback of 001 (FC 008 F1). Local use only: scripts/migrateDb.ts --down refuses any host but
-- localhost. Drops in reverse dependency order; the migrator then removes 001 from
-- schema_migrations. Production never rolls back by dropping tables: it restores the encrypted
-- backup taken before the migration (docs/runbooks/incident-response.md).

DROP TABLE IF EXISTS product_images;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS exchange_rates;
DROP TABLE IF EXISTS experience_levels;
DROP TABLE IF EXISTS categories;
