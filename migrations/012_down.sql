-- Rollback of 012 (FC 052 F0). Local use only: scripts/migrateDb.ts --down refuses any host but
-- localhost. Production never rolls back by deleting: it restores the encrypted backup taken
-- before the migration. A discipline that already has products cannot go (the foreign key of
-- products restricts it): the rollback then fails instead of orphaning them.

DELETE FROM categories WHERE slug IN ('campismo', 'preparacionismo');
