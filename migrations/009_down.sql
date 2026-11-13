-- Rollback of 009 (FC 047 F0). Local use only: scripts/migrateDb.ts --down refuses any host but
-- localhost. Production never rolls back by deleting: it restores the encrypted backup taken
-- before the migration.

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS fk_users_shipping_state,
  DROP CONSTRAINT IF EXISTS ck_users_shipping_pair;

ALTER TABLE users
  DROP COLUMN IF EXISTS shipping_state,
  DROP COLUMN IF EXISTS shipping_postal_code_enc;
