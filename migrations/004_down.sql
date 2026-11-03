-- Rollback of 004 (FC 028 F0). Local use only: scripts/migrateDb.ts --down refuses any host but
-- localhost. Production never rolls back by dropping: it restores the encrypted backup taken
-- before the migration.

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS fk_orders_user,
  DROP COLUMN IF EXISTS user_id;

DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS outbox_events;
DROP TABLE IF EXISTS two_factor_challenges;
DROP TABLE IF EXISTS two_factor_backup_codes;
DROP TABLE IF EXISTS two_factor_auth;
DROP TABLE IF EXISTS user_sessions;
DROP TABLE IF EXISTS user_roles;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS users;
