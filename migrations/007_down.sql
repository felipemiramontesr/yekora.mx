-- Rollback of 007 (FC 042 F0). Local use only: scripts/migrateDb.ts --down refuses any host but
-- localhost. Production never rolls back by dropping: it restores the encrypted backup taken
-- before the migration.

DROP TABLE IF EXISTS password_reset_tokens;
