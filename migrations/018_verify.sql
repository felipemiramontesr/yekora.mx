-- FC 072 F0 · Verification counters of migration 018 (users, roles and permissions).
-- Aggregates only, never data rows; read-only. Run by scripts/migrateDb.ts after 018 is applied
-- or found registered. Not a migration (does not match MIGRATION_NAME).
-- Expected right after 018: the two columns of roles (columns_added 2); owner and customer as
-- system roles (system_roles 2); the Vendedor (staff_orders renamed and assignable: seller_renamed
-- 1) and the support role staff_catalog (catalog_assignable 1); the two new permissions
-- (permissions_added 2); roles:manage held by the owner alone (roles_manage_holders 1);
-- sellers:manage held by owner and admin (sellers_manage_holders 2); and the owner as the union
-- of the catalog of the API, ten permissions of before plus the two new ones (owner_permissions 12).
SELECT
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'roles'
      AND COLUMN_NAME IN ('is_system', 'assignable_by_admin')) AS columns_added,
  (SELECT COUNT(*) FROM roles WHERE is_system = 1 AND id IN ('owner', 'customer')) AS system_roles,
  (SELECT COUNT(*) FROM roles
    WHERE id = 'staff_orders' AND name = 'Vendedor' AND assignable_by_admin = 1) AS seller_renamed,
  (SELECT COUNT(*) FROM roles
    WHERE id = 'staff_catalog' AND name = 'Staff · Catálogo' AND assignable_by_admin = 1) AS catalog_assignable,
  (SELECT COUNT(*) FROM permissions WHERE id IN ('roles:manage', 'sellers:manage')) AS permissions_added,
  (SELECT COUNT(*) FROM role_permissions WHERE permission_id = 'roles:manage') AS roles_manage_holders,
  (SELECT COUNT(*) FROM role_permissions
    WHERE permission_id = 'sellers:manage' AND role_id IN ('owner', 'admin')) AS sellers_manage_holders,
  (SELECT COUNT(*) FROM role_permissions WHERE role_id = 'owner') AS owner_permissions;
