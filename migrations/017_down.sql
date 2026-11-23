-- Rollback of 017 (FC 071 F0). Local use only: scripts/migrateDb.ts --down refuses any host but
-- localhost. Production never rolls back by deleting: it restores the encrypted backup taken
-- before the migration. The grants and permissions go, the two tables of the returns are dropped
-- (lines first), and the column leaves products and order_items with its check.

DELETE FROM role_permissions WHERE permission_id IN ('returns:view', 'returns:prepare', 'returns:confirm');
DELETE FROM permissions WHERE id IN ('returns:view', 'returns:prepare', 'returns:confirm');

DROP TABLE IF EXISTS order_return_items;
DROP TABLE IF EXISTS order_returns;

ALTER TABLE order_items
  DROP CONSTRAINT IF EXISTS ck_order_items_allows_return,
  DROP COLUMN IF EXISTS allows_return;

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS ck_products_allows_return,
  DROP COLUMN IF EXISTS allows_return;
