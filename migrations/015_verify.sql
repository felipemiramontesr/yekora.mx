-- FC 067 F0 · Verification counters of migration 015 (the language of the mail).
-- Aggregates only, never data rows; read-only. Run by scripts/migrateDb.ts after 015 is applied
-- or found registered. Not a migration (does not match MIGRATION_NAME).
-- Expected right after 015: both columns exist (columns 2); no row holds anything outside the
-- catalog (outside_catalog 0); and, right after a first run, every account and order that existed
-- carries the default (users_default = users, orders_default = orders).
SELECT
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND ((TABLE_NAME = 'users' AND COLUMN_NAME = 'preferred_locale')
        OR (TABLE_NAME = 'orders' AND COLUMN_NAME = 'locale'))) AS columns_added,
  (SELECT COUNT(*) FROM users WHERE preferred_locale NOT IN ('es-MX', 'en')) AS users_outside_catalog,
  (SELECT COUNT(*) FROM orders WHERE locale NOT IN ('es-MX', 'en')) AS orders_outside_catalog,
  (SELECT COUNT(*) FROM users WHERE preferred_locale = 'en') AS users_english,
  (SELECT COUNT(*) FROM orders WHERE locale = 'en') AS orders_english;
