-- FC 076 F0 · Verification counters of migration 020 (point of sale).
-- Aggregates only, never data rows; read-only. Run by scripts/migrateDb.ts after 020 is applied
-- or found registered. Not a migration (does not match MIGRATION_NAME).
-- Expected right after 020: the two tables (tables 2); the nine columns of orders (order_columns 9)
-- and refund_method of the returns (return_columns 1); the unique key of the single open shift
-- (open_unique 1); the processor and the two methods (processors 1, methods 2); the three
-- permissions (permissions_added 3) with their eight grants (grants 8); no existing order moved to
-- the counter (pos_orders 0).
SELECT
  (SELECT COUNT(*) FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('pos_shifts', 'pos_cash_movements')) AS tables,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
      AND (COLUMN_NAME = 'channel' OR COLUMN_NAME LIKE 'pos\_%')) AS order_columns,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_returns'
      AND COLUMN_NAME = 'refund_method') AS return_columns,
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pos_shifts'
      AND CONSTRAINT_NAME = 'uq_pos_shifts_single_open') AS open_unique,
  (SELECT COUNT(*) FROM payment_processors WHERE id = 3 AND code = 'LOCAL') AS processors,
  (SELECT COUNT(*) FROM payment_methods WHERE id IN (5, 6) AND processor_id = 3) AS methods,
  (SELECT COUNT(*) FROM permissions WHERE id IN ('pos:sell', 'pos:shift', 'pos:supervisor')) AS permissions_added,
  (SELECT COUNT(*) FROM role_permissions
    WHERE permission_id IN ('pos:sell', 'pos:shift', 'pos:supervisor')
      AND role_id IN ('owner', 'admin', 'staff_orders')) AS grants,
  (SELECT COUNT(*) FROM orders WHERE channel = 'pos') AS pos_orders;
