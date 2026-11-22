-- Rollback of 016 (FC 068 F0). Local use only: scripts/migrateDb.ts --down refuses any host but
-- localhost. Production never rolls back by deleting: it restores the encrypted backup taken
-- before the migration. Orders in a fulfillment state go back to PAID, the permission and its
-- grants go, the three states leave the reference table, the checks return to their form of 003
-- and the five columns are dropped.

UPDATE orders SET status_id = 2 WHERE status_id IN (7, 8, 9);

DELETE FROM role_permissions WHERE permission_id = 'orders:manage';
DELETE FROM permissions WHERE id = 'orders:manage';

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS ck_orders_fulfillment,
  DROP CONSTRAINT IF EXISTS ck_orders_paid_at,
  DROP CONSTRAINT IF EXISTS ck_orders_payment_resource,
  DROP COLUMN IF EXISTS carrier,
  DROP COLUMN IF EXISTS tracking_number,
  DROP COLUMN IF EXISTS tracking_url,
  DROP COLUMN IF EXISTS shipped_at,
  DROP COLUMN IF EXISTS delivered_at,
  ADD CONSTRAINT ck_orders_paid_at CHECK ((status_id IN (2, 5)) = (paid_at IS NOT NULL) OR status_id = 6),
  ADD CONSTRAINT ck_orders_payment_resource CHECK (status_id NOT IN (2, 5) OR payment_resource_id IS NOT NULL);

DELETE FROM order_statuses WHERE id IN (7, 8, 9);
