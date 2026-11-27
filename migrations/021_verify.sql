-- FC 077 F0 · Verification counters of migration 021 (invoicing).
-- Aggregates only, never data rows; read-only. Run by scripts/migrateDb.ts after 021 is applied
-- or found registered. Not a migration (does not match MIGRATION_NAME).
-- Expected right after 021: the three tables (tables 3); the two single-active keys and the key of
-- the SAT folio (unique_keys 3); the two blob columns (blobs 2); the three permissions
-- (permissions_added 3) with their eight grants (grants 8); no request and no invoice yet
-- (requests 0, invoices 0).
SELECT
  (SELECT COUNT(*) FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN ('customer_fiscal_profiles', 'invoice_requests', 'order_invoices')) AS tables,
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND CONSTRAINT_NAME IN ('uq_invoice_requests_active_order', 'uq_order_invoices_order_active', 'uq_order_invoices_uuid')) AS unique_keys,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_invoices' AND DATA_TYPE = 'mediumblob') AS blobs,
  (SELECT COUNT(*) FROM permissions
    WHERE id IN ('invoices:read', 'invoices:upload', 'invoices:request')) AS permissions_added,
  (SELECT COUNT(*) FROM role_permissions
    WHERE permission_id IN ('invoices:read', 'invoices:upload', 'invoices:request')
      AND role_id IN ('owner', 'admin', 'staff_orders')) AS grants,
  (SELECT COUNT(*) FROM invoice_requests) AS requests,
  (SELECT COUNT(*) FROM order_invoices) AS invoices;
