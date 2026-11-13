-- FC 047 F0 · Verification counters of migration 009 (the delivery postal code of an account).
-- Aggregates only, never data rows; read-only. Run by scripts/migrateDb.ts after 009 is applied
-- or found registered. Not a migration (does not match MIGRATION_NAME).
-- Expected right after 009: both columns exist (2); the pairing check and the foreign key to
-- shipping_zones exist (2); and no account holds one of the two columns without the other (0).
SELECT
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'users'
      AND column_name IN ('shipping_postal_code_enc', 'shipping_state')) AS postal_columns,
  (SELECT COUNT(*) FROM information_schema.table_constraints
    WHERE table_schema = DATABASE() AND table_name = 'users'
      AND constraint_name IN ('ck_users_shipping_pair', 'fk_users_shipping_state')) AS postal_constraints,
  (SELECT COUNT(*) FROM users
    WHERE (shipping_postal_code_enc IS NULL) <> (shipping_state IS NULL)) AS unpaired_accounts;
