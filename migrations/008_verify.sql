-- FC 044 F0 · Verification counters of migration 008 (the owner role).
-- Aggregates only, never data rows; read-only. Run by scripts/migrateDb.ts after 008 is applied
-- or found registered. Not a migration (does not match MIGRATION_NAME).
-- Expected right after 008: the role, active (1); as many permissions for it as the catalog has
-- (owner_permissions = permissions); and no account holding it yet (0): the owner is
-- provisioned out of band, never by a migration.
SELECT
  (SELECT COUNT(*) FROM roles WHERE id = 'owner' AND is_active = 1) AS owner_role,
  (SELECT COUNT(*) FROM permissions) AS permissions,
  (SELECT COUNT(*) FROM role_permissions WHERE role_id = 'owner') AS owner_permissions,
  (SELECT COUNT(*) FROM user_roles WHERE role_id = 'owner') AS owner_accounts;
