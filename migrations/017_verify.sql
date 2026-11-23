-- FC 071 F0 · Verification counters of migration 017 (returns and «allows return»).
-- Aggregates only, never data rows; read-only. Run by scripts/migrateDb.ts after 017 is applied
-- or found registered. Not a migration (does not match MIGRATION_NAME).
-- Expected right after 017: the column in products and in order_items (columns_added 2); the two
-- tables (tables_added 2); the three permissions (permissions_added 3); who holds them (view and
-- prepare in owner, admin and staff_orders, confirm in owner and admin: granted_roles 8); and,
-- until the first request is made, no return (returns 0) and nothing that cannot be returned
-- among the products or the lines (non_returnable_products 0, non_returnable_lines 0).
SELECT
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'allows_return'
      AND TABLE_NAME IN ('products', 'order_items')) AS columns_added,
  (SELECT COUNT(*) FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('order_returns', 'order_return_items')) AS tables_added,
  (SELECT COUNT(*) FROM permissions
    WHERE id IN ('returns:view', 'returns:prepare', 'returns:confirm')) AS permissions_added,
  (SELECT COUNT(*) FROM role_permissions
    WHERE permission_id IN ('returns:view', 'returns:prepare', 'returns:confirm')
      AND role_id IN ('owner', 'admin', 'staff_orders')) AS granted_roles,
  (SELECT COUNT(*) FROM order_returns) AS returns,
  (SELECT COUNT(*) FROM products WHERE allows_return = 0) AS non_returnable_products,
  (SELECT COUNT(*) FROM order_items WHERE allows_return = 0) AS non_returnable_lines;
