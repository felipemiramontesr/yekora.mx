-- FC 075 F0 · Verification counters of migration 019 (tickets of the payments mode switch).
-- Aggregates only, never data rows; read-only. Run by scripts/migrateDb.ts after 019 is applied
-- or found registered. Not a migration (does not match MIGRATION_NAME).
-- Expected right after 019: the table exists (tables 1) with its thirteen columns (columns 13),
-- its two foreign keys to users (foreign_keys 2) and its four checks (checks 4), and no column
-- that could hold a secret or a one-time code (secret_columns 0); no ticket yet (tickets 0).
SELECT
  (SELECT COUNT(*) FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments_mode_tickets') AS tables,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments_mode_tickets') AS columns,
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments_mode_tickets'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY') AS foreign_keys,
  (SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'payments_mode_tickets') AS checks,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments_mode_tickets'
      AND (COLUMN_NAME LIKE '%secret%' OR COLUMN_NAME LIKE '%code%' OR COLUMN_NAME LIKE '%key')) AS secret_columns,
  (SELECT COUNT(*) FROM payments_mode_tickets) AS tickets;
