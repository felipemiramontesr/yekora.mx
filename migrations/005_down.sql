-- Rollback of 005 (FC 028 Enmienda 1). Local use only: scripts/migrateDb.ts --down refuses any
-- host but localhost. Production never rolls back by dropping: it restores the encrypted backup
-- taken before the migration.

DROP TABLE IF EXISTS user_trusted_devices;
DROP TABLE IF EXISTS auth_challenge_nonces;
