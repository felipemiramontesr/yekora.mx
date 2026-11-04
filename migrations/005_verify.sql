-- FC 028 Enmienda 1 · Verification counters of migration 005 (anti-bot nonces, trusted devices).
-- Aggregates only, never data rows or tokens; read-only. Run by scripts/migrateDb.ts after 005 is
-- applied or found registered. Not a migration (does not match MIGRATION_NAME).
-- Expected right after 005: both tables present (1 each), and live counts of spent challenges and
-- remembered devices.
SELECT
  (SELECT COUNT(*) FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auth_challenge_nonces') AS nonce_table,
  (SELECT COUNT(*) FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_trusted_devices') AS device_table,
  (SELECT COUNT(*) FROM auth_challenge_nonces) AS spent_challenges,
  (SELECT COUNT(*) FROM user_trusted_devices) AS trusted_devices;
