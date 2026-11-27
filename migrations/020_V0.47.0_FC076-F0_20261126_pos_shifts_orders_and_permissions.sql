-- 020 · V0.47.0 · FC 076 F0 · 2026-11-26 · Point of sale: cash shifts, counter sales and returns.
--
-- The store gets a counter that sells from the same stock as the web (K-79). This migration adds:
--   pos_shifts          one till session; the database itself allows only one open at a time
--                       (open_marker is 1 while open and NULL after, under a unique key, T0.2);
--   pos_cash_movements  cash put in or taken out of the drawer, including the cash of a return;
--   orders.channel      'online' or 'pos', with what a counter sale keeps: its shift, its
--                       cashier, the cash given and the change, or the terminal's authorization,
--                       the last four digits, the brand and the voucher folio (never a card
--                       number, T0.1);
--   order_returns.refund_method  how a counter return was paid back: cash or terminal;
--   processor LOCAL, methods POS_CASH (5) and POS_CARD_MANUAL (6), and the permissions
--                       pos:sell, pos:shift and pos:supervisor.
--
-- A counter sale is born delivered (status 9) with no carrier: ck_orders_fulfillment exempts
-- only the 'pos' channel from the carrier and tracking number, and keeps every other rule of
-- migration 016 (shipped and delivered web orders still need them). The contract's own text of the
-- constraint dropped the requirement for status 8; it is kept here.
--
-- Existing orders are 'online' by default. Idempotent (DB_LAW): CREATE TABLE IF NOT EXISTS,
-- ADD COLUMN IF NOT EXISTS, DROP ... IF EXISTS before each ADD, and INSERT IGNORE.

CREATE TABLE IF NOT EXISTS pos_shifts (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  cashier_user_id CHAR(36) NOT NULL,
  opened_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  opening_cash_mxn_cents INT UNSIGNED NOT NULL,
  closed_at DATETIME NULL,
  expected_cash_mxn_cents INT UNSIGNED NULL,
  counted_cash_mxn_cents INT UNSIGNED NULL,
  cash_difference_mxn_cents INT NULL,
  closed_by_user_id CHAR(36) NULL,
  notes VARCHAR(255) NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'OPEN',
  open_marker TINYINT GENERATED ALWAYS AS (IF(status = 'OPEN', 1, NULL)) VIRTUAL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pos_shifts_single_open (open_marker),
  KEY ix_pos_shifts_cashier (cashier_user_id),
  KEY ix_pos_shifts_status (status, opened_at),
  CONSTRAINT fk_pos_shifts_cashier FOREIGN KEY (cashier_user_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_pos_shifts_closer FOREIGN KEY (closed_by_user_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_pos_shifts_status CHECK (status IN ('OPEN', 'CLOSED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pos_cash_movements (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  shift_id INT UNSIGNED NOT NULL,
  type VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  amount_mxn_cents INT UNSIGNED NOT NULL,
  reason VARCHAR(255) NOT NULL,
  authorized_by_user_id CHAR(36) NOT NULL,
  return_id INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_pos_cash_movements_shift (shift_id),
  KEY ix_pos_cash_movements_return (return_id),
  CONSTRAINT fk_pos_cash_movements_shift FOREIGN KEY (shift_id)
    REFERENCES pos_shifts (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_pos_cash_movements_authorizer FOREIGN KEY (authorized_by_user_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_pos_cash_movements_return FOREIGN KEY (return_id)
    REFERENCES order_returns (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_pos_cash_movements_type CHECK (type IN ('IN', 'OUT')),
  CONSTRAINT ck_pos_cash_movements_amount CHECK (amount_mxn_cents > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS channel VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'online',
  ADD COLUMN IF NOT EXISTS pos_shift_id INT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS pos_cashier_id CHAR(36) NULL,
  ADD COLUMN IF NOT EXISTS pos_tendered_mxn_cents INT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS pos_change_mxn_cents INT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS pos_terminal_auth_code VARCHAR(32) NULL,
  ADD COLUMN IF NOT EXISTS pos_terminal_last_four CHAR(4) NULL,
  ADD COLUMN IF NOT EXISTS pos_terminal_brand VARCHAR(16) NULL,
  ADD COLUMN IF NOT EXISTS pos_terminal_voucher_folio VARCHAR(64) NULL,
  DROP FOREIGN KEY IF EXISTS fk_orders_pos_shift,
  DROP FOREIGN KEY IF EXISTS fk_orders_pos_cashier,
  DROP CONSTRAINT IF EXISTS ck_orders_channel,
  DROP CONSTRAINT IF EXISTS ck_orders_fulfillment;

ALTER TABLE orders
  ADD CONSTRAINT fk_orders_pos_shift FOREIGN KEY (pos_shift_id)
    REFERENCES pos_shifts (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT fk_orders_pos_cashier FOREIGN KEY (pos_cashier_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT ck_orders_channel CHECK (channel IN ('online', 'pos')),
  ADD CONSTRAINT ck_orders_fulfillment CHECK (
    (status_id NOT IN (8, 9) OR channel = 'pos'
      OR (carrier IS NOT NULL AND tracking_number IS NOT NULL AND shipped_at IS NOT NULL))
    AND (status_id <> 9 OR delivered_at IS NOT NULL)
  );

ALTER TABLE order_returns
  ADD COLUMN IF NOT EXISTS refund_method VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL,
  DROP CONSTRAINT IF EXISTS ck_order_returns_refund_method,
  ADD CONSTRAINT ck_order_returns_refund_method CHECK (refund_method IN ('CASH', 'TERMINAL'));

INSERT IGNORE INTO payment_processors (id, code, name) VALUES (3, 'LOCAL', 'Punto de Venta Local');

INSERT IGNORE INTO payment_methods (id, code, processor_id, name_es, name_en, hold_minutes, sort_order) VALUES
  (5, 'POS_CASH', 3, 'Efectivo en mostrador', 'Cash at counter', 60, 5),
  (6, 'POS_CARD_MANUAL', 3, 'Tarjeta en terminal Banorte', 'Card at Banorte terminal', 60, 6);

INSERT IGNORE INTO permissions (id, module, description) VALUES
  ('pos:sell', 'pos', 'Cobrar en el mostrador en el turno de caja abierto.'),
  ('pos:shift', 'pos', 'Abrir, mover efectivo y cerrar el turno de caja propio.'),
  ('pos:supervisor', 'pos', 'Cerrar turnos ajenos y autorizar descuadres y retiros grandes.');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r JOIN permissions p ON p.id IN ('pos:sell', 'pos:shift')
  WHERE r.id IN ('owner', 'admin', 'staff_orders');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
  SELECT r.id, 'pos:supervisor' FROM roles r WHERE r.id IN ('owner', 'admin');
