-- Rollback of 014 (FC 061 F0). Local use only: scripts/migrateDb.ts --down refuses any host but
-- localhost. Production never rolls back by deleting: it restores the encrypted backup taken
-- before the migration. Removes the permission and its grants, then the seeded rate of each
-- state (only those that still carry the seeded 15 000 cents) and the configuration row when it
-- is still the seeded one (ZONE_RATE, free shipping off); an edited row is left alone.

DELETE FROM role_permissions WHERE permission_id = 'shipping:manage';
DELETE FROM permissions WHERE id = 'shipping:manage';
DELETE FROM shipping_rules WHERE strategy_id = 2 AND rate_mxn_cents = 15000;
DELETE FROM shipping_configs
  WHERE id = 1 AND active_strategy_id = 2 AND is_free_shipping_active = 0
    AND NOT EXISTS (SELECT 1 FROM shipping_rules WHERE strategy_id = 2);
