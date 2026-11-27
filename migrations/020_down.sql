-- Rollback of 020 (FC 076 F0). Local use only: scripts/migrateDb.ts --down refuses any host but
-- localhost. Production never rolls back by deleting: it restores the encrypted backup taken
-- before the migration. It assumes no counter sale exists: a sale kept would break the old
-- constraint, and the rollback then stops there.

DELETE FROM role_permissions WHERE permission_id IN ('pos:sell', 'pos:shift', 'pos:supervisor');
DELETE FROM permissions WHERE id IN ('pos:sell', 'pos:shift', 'pos:supervisor');

DROP TABLE IF EXISTS pos_cash_movements;

ALTER TABLE orders
  DROP FOREIGN KEY IF EXISTS fk_orders_pos_shift,
  DROP FOREIGN KEY IF EXISTS fk_orders_pos_cashier,
  DROP CONSTRAINT IF EXISTS ck_orders_channel,
  DROP CONSTRAINT IF EXISTS ck_orders_fulfillment;

ALTER TABLE orders
  DROP COLUMN IF EXISTS channel,
  DROP COLUMN IF EXISTS pos_shift_id,
  DROP COLUMN IF EXISTS pos_cashier_id,
  DROP COLUMN IF EXISTS pos_tendered_mxn_cents,
  DROP COLUMN IF EXISTS pos_change_mxn_cents,
  DROP COLUMN IF EXISTS pos_terminal_auth_code,
  DROP COLUMN IF EXISTS pos_terminal_last_four,
  DROP COLUMN IF EXISTS pos_terminal_brand,
  DROP COLUMN IF EXISTS pos_terminal_voucher_folio,
  ADD CONSTRAINT ck_orders_fulfillment CHECK (
    (status_id NOT IN (8, 9) OR (carrier IS NOT NULL AND tracking_number IS NOT NULL AND shipped_at IS NOT NULL))
    AND (status_id <> 9 OR delivered_at IS NOT NULL)
  );

DROP TABLE IF EXISTS pos_shifts;

ALTER TABLE order_returns
  DROP CONSTRAINT IF EXISTS ck_order_returns_refund_method,
  DROP COLUMN IF EXISTS refund_method;

DELETE FROM payment_methods WHERE id IN (5, 6);
DELETE FROM payment_processors WHERE id = 3;
