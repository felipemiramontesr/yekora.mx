-- Rollback of 011 (FC 051 F0). Local use only: scripts/migrateDb.ts --down refuses any host but
-- localhost. Production never rolls back by deleting: it restores the encrypted backup taken
-- before the migration. It restores the structure of 009 (the postal code and state of an account,
-- empty: the addresses that held them go with their table) and drops the phone, the default
-- address pointer and the book of addresses.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS shipping_postal_code_enc VARBINARY(64) NULL AFTER full_name,
  ADD COLUMN IF NOT EXISTS shipping_state CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER shipping_postal_code_enc;

ALTER TABLE users
  ADD CONSTRAINT IF NOT EXISTS ck_users_shipping_pair
    CHECK ((shipping_postal_code_enc IS NULL) = (shipping_state IS NULL)),
  ADD CONSTRAINT fk_users_shipping_state FOREIGN KEY IF NOT EXISTS (shipping_state)
    REFERENCES shipping_zones (code) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS fk_users_default_address;

ALTER TABLE users
  DROP COLUMN IF EXISTS default_address_id,
  DROP COLUMN IF EXISTS phone_enc;

DROP TABLE IF EXISTS user_addresses;
