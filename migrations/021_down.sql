-- Rollback of 021 (FC 077 F0). Local use only: scripts/migrateDb.ts --down refuses any host but
-- localhost. Production never rolls back by deleting: it restores the encrypted backup taken
-- before the migration.

DELETE FROM role_permissions WHERE permission_id IN ('invoices:read', 'invoices:upload', 'invoices:request');
DELETE FROM permissions WHERE id IN ('invoices:read', 'invoices:upload', 'invoices:request');

DROP TABLE IF EXISTS order_invoices;
DROP TABLE IF EXISTS invoice_requests;
DROP TABLE IF EXISTS customer_fiscal_profiles;
