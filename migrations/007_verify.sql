-- FC 042 F0 · Verification counters of migration 007 (password reset tokens).
-- Aggregates only, never data rows or token hashes; read-only. Run by scripts/migrateDb.ts after
-- 007 is applied or found registered. Not a migration (does not match MIGRATION_NAME).
-- Expected right after 007: the new table (1), its unique hash key (1), its lookup index on
-- three columns (3), its foreign key to users (1), and no reset link yet (0).
SELECT
  (SELECT COUNT(*) FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'password_reset_tokens') AS new_tables,
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'password_reset_tokens'
       AND INDEX_NAME = 'uq_password_reset_tokens_hash' AND NON_UNIQUE = 0) AS unique_hash,
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'password_reset_tokens'
       AND INDEX_NAME = 'idx_token_lookup') AS lookup_columns,
  (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'password_reset_tokens'
       AND REFERENCED_TABLE_NAME = 'users' AND DELETE_RULE = 'CASCADE') AS user_fk,
  (SELECT COUNT(*) FROM password_reset_tokens) AS reset_links;
