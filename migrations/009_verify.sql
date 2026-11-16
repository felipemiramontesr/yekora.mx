-- FC 047 F0 · Verification counters of migration 009 (the delivery postal code of an account).
-- Aggregates only, never data rows; read-only. Run by scripts/migrateDb.ts after 009 is applied
-- or found registered. Not a migration (does not match MIGRATION_NAME).
-- It reads only information_schema, because migration 011 (FC 051) retires both columns: right
-- after 009 they exist (2) with their pairing check and foreign key (2); after 011 both counters
-- read 0, and 011_verify.sql is the one that says so.
SELECT
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
      AND COLUMN_NAME IN ('shipping_postal_code_enc', 'shipping_state')) AS postal_columns,
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
      AND CONSTRAINT_NAME IN ('ck_users_shipping_pair', 'fk_users_shipping_state')) AS postal_constraints;
