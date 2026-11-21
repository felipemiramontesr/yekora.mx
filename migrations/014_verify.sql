-- FC 061 F0 · Verification counters of migration 014 (shipping configuration and state rates).
-- Aggregates only, never data rows; read-only. Run by scripts/migrateDb.ts after 014 is applied
-- or found registered. Not a migration (does not match MIGRATION_NAME).
-- Expected right after 014: the configuration row (config_row 1); every active state covered by
-- an active ZONE_RATE rule (uncovered_zones 0); the permission opened (permission 1) and held
-- by owner and admin (granted_roles 2).
SELECT
  (SELECT COUNT(*) FROM shipping_configs WHERE id = 1) AS config_row,
  (SELECT COUNT(*) FROM shipping_zones z
    LEFT JOIN shipping_rules r
      ON r.strategy_id = 2 AND r.zone_id = z.id AND r.is_active = 1
    WHERE z.is_active = 1 AND r.id IS NULL) AS uncovered_zones,
  (SELECT COUNT(*) FROM permissions WHERE id = 'shipping:manage') AS permission,
  (SELECT COUNT(*) FROM role_permissions
    WHERE permission_id = 'shipping:manage' AND role_id IN ('owner', 'admin')) AS granted_roles;
