-- FC 028 F0 · Verification counters of migration 004 (identity, RBAC, outbox, audit).
-- Aggregates only, never data rows or personal data; read-only. Run by scripts/migrateDb.ts after
-- 004 is applied or found registered. Not a migration (does not match MIGRATION_NAME).
-- Expected after 004: roles 4, permissions 5, admin_permissions = permissions (admin is the
-- union), orders_with_user 0; users, sessions and outbox events are live counts.
SELECT
  (SELECT COUNT(*) FROM roles
     WHERE id IN ('admin', 'staff_orders', 'staff_catalog', 'customer')) AS roles,
  (SELECT COUNT(*) FROM permissions) AS permissions,
  (SELECT COUNT(*) FROM role_permissions WHERE role_id = 'admin') AS admin_permissions,
  (SELECT COUNT(*) FROM users) AS users,
  (SELECT COUNT(*) FROM user_sessions) AS sessions,
  (SELECT COUNT(*) FROM outbox_events WHERE status = 'PENDING') AS outbox_pending,
  (SELECT COUNT(*) FROM orders WHERE user_id IS NOT NULL) AS orders_with_user;
