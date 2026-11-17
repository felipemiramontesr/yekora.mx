-- Rollback of 013 (FC 054 F0). Local use only: scripts/migrateDb.ts --down refuses any host but
-- localhost. Production never rolls back by deleting: it restores the encrypted backup taken
-- before the migration. The table only links an account to its Stripe customer; the cards live at
-- Stripe, so dropping it loses no card, only the link (the next «add a card» creates it again).

DROP TABLE IF EXISTS user_stripe_customers;
