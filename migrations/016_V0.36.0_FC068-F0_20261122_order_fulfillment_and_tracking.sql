-- 016 · V0.36.0 · FC 068 F0 · 2026-11-22 · Order fulfillment: preparing, shipped, delivered, and the tracking of the parcel.
--
-- Until now an order stopped at PAID: nothing said that it was being prepared, that it left, or
-- where the parcel was. This migration adds the three states of the fulfillment (K-48), the data
-- of the shipment, and the permission to operate it:
--   order_statuses 7 PREPARING, 8 SHIPPED, 9 DELIVERED   (reference data, never renumbered);
--   orders.carrier, tracking_number, tracking_url        what the parcel travels with;
--   orders.shipped_at, delivered_at                      when it left and when it arrived;
--   permissions orders:manage                            to prepare, ship and deliver an order,
--                                                        for staff_orders, admin and owner.
--
-- The two checks that tie an order's money to its status listed the statuses that had been paid
-- (2 PAID and 5 REFUNDED). An order being prepared, shipped or delivered has been paid too, so
-- both are rewritten to include 7, 8 and 9: without it the first transition would be refused by
-- the database. A new check keeps a shipped or delivered order from losing its parcel: carrier,
-- tracking number and shipping time are never NULL from SHIPPED on, and a delivered order has its
-- delivery time. Existing rows satisfy all of them (no order is in a new status), so nothing is
-- rewritten and no data changes.
--
-- Idempotent (DB_LAW): INSERT IGNORE on the keys, ADD COLUMN IF NOT EXISTS, and DROP CONSTRAINT IF
-- EXISTS before each ADD CONSTRAINT, so a second run leaves the same checks and changes nothing.

INSERT IGNORE INTO order_statuses (id, code, name_es, name_en) VALUES
  (7, 'PREPARING', 'En preparación', 'Preparing'),
  (8, 'SHIPPED', 'Enviado', 'Shipped'),
  (9, 'DELIVERED', 'Entregado', 'Delivered');

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS carrier VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(128) NULL,
  ADD COLUMN IF NOT EXISTS tracking_url VARCHAR(512) NULL,
  ADD COLUMN IF NOT EXISTS shipped_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS delivered_at DATETIME NULL,
  DROP CONSTRAINT IF EXISTS ck_orders_paid_at,
  DROP CONSTRAINT IF EXISTS ck_orders_payment_resource,
  DROP CONSTRAINT IF EXISTS ck_orders_fulfillment,
  ADD CONSTRAINT ck_orders_paid_at CHECK ((status_id IN (2, 5, 7, 8, 9)) = (paid_at IS NOT NULL) OR status_id = 6),
  ADD CONSTRAINT ck_orders_payment_resource CHECK (status_id NOT IN (2, 5, 7, 8, 9) OR payment_resource_id IS NOT NULL),
  ADD CONSTRAINT ck_orders_fulfillment CHECK (
    (status_id NOT IN (8, 9) OR (carrier IS NOT NULL AND tracking_number IS NOT NULL AND shipped_at IS NOT NULL))
    AND (status_id <> 9 OR delivered_at IS NOT NULL)
  );

INSERT IGNORE INTO permissions (id, module, description) VALUES
  ('orders:manage', 'orders', 'Preparar, enviar y entregar pedidos: registrar la guía y cambiar su estado.');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
  SELECT r.id, 'orders:manage' FROM roles r WHERE r.id IN ('owner', 'admin', 'staff_orders');
