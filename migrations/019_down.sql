-- Rollback of 019 (FC 075 F0). Local use only: scripts/migrateDb.ts --down refuses any host but
-- localhost. Production never rolls back by deleting: it restores the encrypted backup taken
-- before the migration. The tickets of the payments mode switch go with their table.

DROP TABLE IF EXISTS payments_mode_tickets;
