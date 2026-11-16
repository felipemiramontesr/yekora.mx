-- FC 051 F0 · Verification counters of migration 011 (the phone and the book of addresses).
-- Aggregates only, never data rows; read-only. Run by scripts/migrateDb.ts after 011 is applied
-- or found registered. Not a migration (does not match MIGRATION_NAME).
-- Expected right after 011: the owner's account is untouched, with no phone and no default address
-- (owner_intact 1); the table of addresses exists (address_table 1); the phone and the default
-- address pointer exist (profile_columns 2); and the postal code and state of 009 are gone from
-- users, columns and constraints alike (postal_columns 0, postal_constraints 0).
SELECT
  IF((SELECT COUNT(*) FROM users u
        JOIN user_roles r ON r.user_id = u.id AND r.role_id = 'owner'
      WHERE u.phone_enc IS NOT NULL OR u.default_address_id IS NOT NULL) = 0, 1, 0) AS owner_intact,
  (SELECT COUNT(*) FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_addresses') AS address_table,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
      AND COLUMN_NAME IN ('phone_enc', 'default_address_id')) AS profile_columns,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
      AND COLUMN_NAME IN ('shipping_postal_code_enc', 'shipping_state')) AS postal_columns,
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
      AND CONSTRAINT_NAME IN ('ck_users_shipping_pair', 'fk_users_shipping_state')) AS postal_constraints;
