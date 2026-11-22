-- FC 068 F0 · Verification counters of migration 016 (order fulfillment and tracking).
-- Aggregates only, never data rows; read-only. Run by scripts/migrateDb.ts after 016 is applied
-- or found registered. Not a migration (does not match MIGRATION_NAME).
-- Expected right after 016: the three states (new_states 3); the five columns (columns_added 5);
-- the permission held by owner, admin and staff_orders (granted_roles 3); and, until the first
-- order is prepared, no order in a fulfillment state (in_fulfillment 0, shipped_without_parcel 0).
SELECT
  (SELECT COUNT(*) FROM order_statuses WHERE id IN (7, 8, 9)) AS new_states,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders'
      AND COLUMN_NAME IN ('carrier', 'tracking_number', 'tracking_url', 'shipped_at', 'delivered_at')) AS columns_added,
  (SELECT COUNT(*) FROM role_permissions
    WHERE permission_id = 'orders:manage' AND role_id IN ('owner', 'admin', 'staff_orders')) AS granted_roles,
  (SELECT COUNT(*) FROM orders WHERE status_id IN (7, 8, 9)) AS in_fulfillment,
  (SELECT COUNT(*) FROM orders
    WHERE status_id IN (8, 9) AND (carrier IS NULL OR tracking_number IS NULL OR shipped_at IS NULL)) AS shipped_without_parcel;
