-- FC 054 F0 · Verification counters of migration 013 (the link to the Stripe customer).
-- Aggregates only, never data rows; read-only. Run by scripts/migrateDb.ts after 013 is applied
-- or found registered. Not a migration (does not match MIGRATION_NAME).
-- Expected right after 013: the owner's account has no link (owner_intact 1); the table exists
-- (table_created 1); its foreign key to users exists (fk_intact 1); its customer id is unique
-- (unique_customer 1); and no column holds card data (card_columns 0).
SELECT
  IF((SELECT COUNT(*) FROM user_stripe_customers c
        JOIN user_roles r ON r.user_id = c.user_id AND r.role_id = 'owner') = 0, 1, 0) AS owner_intact,
  (SELECT COUNT(*) FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_stripe_customers') AS table_created,
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_stripe_customers'
      AND CONSTRAINT_NAME = 'fk_user_stripe_customers_user'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY') AS fk_intact,
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_stripe_customers'
      AND INDEX_NAME = 'ux_user_stripe_customers_customer' AND NON_UNIQUE = 0) AS unique_customer,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_stripe_customers'
      AND COLUMN_NAME NOT IN ('user_id', 'stripe_customer_id', 'created_at', 'updated_at')) AS card_columns;
