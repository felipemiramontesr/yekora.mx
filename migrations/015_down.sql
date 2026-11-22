-- Rollback of 015 (FC 067 F0). Local use only: scripts/migrateDb.ts --down refuses any host but
-- localhost. Production never rolls back by deleting: it restores the encrypted backup taken
-- before the migration. Drops the two checks and the two columns; the mail goes back to Mexican
-- Spanish, which is what it was before the preference existed.

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS ck_orders_locale,
  DROP COLUMN IF EXISTS locale;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS ck_users_preferred_locale,
  DROP COLUMN IF EXISTS preferred_locale;
