-- Rollback of 008 (FC 044 F0). Local use only: scripts/migrateDb.ts --down refuses any host but
-- localhost. Production never rolls back by deleting: it restores the encrypted backup taken
-- before the migration.

DELETE FROM user_roles WHERE role_id = 'owner';
DELETE FROM role_permissions WHERE role_id = 'owner';
DELETE FROM roles WHERE id = 'owner';
