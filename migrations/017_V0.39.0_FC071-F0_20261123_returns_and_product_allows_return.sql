-- 017 · V0.39.0 · FC 071 F0 · 2026-11-23 · Returns and refunds with a board, and «allows return» per product.
--
-- Until now a buyer could not return anything and an operator could not refund from the panel
-- (K-80). This migration adds the data that the returns need:
--   products.allows_return, order_items.allows_return   whether the unit may be returned; the
--                                                       order line keeps the value the product had
--                                                       when it was bought (a later change of the
--                                                       product never rewrites a past purchase);
--   order_returns                                       one request of the buyer, then prepared
--                                                       by one operator and confirmed by another
--                                                       (four eyes), with the refund it ended in;
--   order_return_items                                  the lines and the units of each request;
--   permissions returns:view, returns:prepare           to see the board and to prepare a refund,
--                                                       for staff_orders, admin and owner;
--   permission returns:confirm                          to confirm and execute it, admin and owner.
--
-- Four eyes (T2.1) is also a rule of the database: ck_order_returns_dual refuses a row whose
-- preparer and confirmer are the same user, whatever the code does. The user columns of the
-- operators have no ON DELETE action that nulls them (a check reads them): a user that prepared or
-- confirmed a refund cannot be deleted, which is what an audit trail asks for.
--
-- Existing products and lines default to 1 (returnable), so nothing is rewritten and no data
-- changes. Idempotent (DB_LAW): ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS before each
-- ADD CONSTRAINT, CREATE TABLE IF NOT EXISTS and INSERT IGNORE.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS allows_return TINYINT(1) NOT NULL DEFAULT 1,
  DROP CONSTRAINT IF EXISTS ck_products_allows_return,
  ADD CONSTRAINT ck_products_allows_return CHECK (allows_return IN (0, 1));

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS allows_return TINYINT(1) NOT NULL DEFAULT 1,
  DROP CONSTRAINT IF EXISTS ck_order_items_allows_return,
  ADD CONSTRAINT ck_order_items_allows_return CHECK (allows_return IN (0, 1));

CREATE TABLE IF NOT EXISTS order_returns (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id INT UNSIGNED NOT NULL,
  -- REQUESTED (the buyer asked) → PREPARED (an operator set the amount) → REFUNDING (the intent is
  -- recorded and the processor is being asked) → REFUNDED (the money left).
  status VARCHAR(12) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'REQUESTED',
  reason VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  comment VARCHAR(500) NULL,
  requested_by CHAR(36) NULL,
  prepared_by CHAR(36) NULL,
  confirmed_by CHAR(36) NULL,
  -- MXN cents with VAT included, set when prepared; never above what the order paid (T2.2).
  refund_mxn_cents INT UNSIGNED NULL,
  -- 1 when the units go back to the shelf, 0 when they are damaged or destroyed (T2.3).
  restock TINYINT(1) NULL,
  -- Stripe's refund (re_…), once it exists: the webhook finds the request by it. Unique, so a
  -- refund is never applied to two requests.
  processor_refund_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
  -- Mercado Pago refunds are made by hand at the processor: the reference of that dispersion.
  manual_reference VARCHAR(128) NULL,
  prepared_at DATETIME NULL,
  confirmed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_order_returns_refund (processor_refund_id),
  KEY ix_order_returns_order (order_id),
  KEY ix_order_returns_status (status, created_at),
  CONSTRAINT fk_order_returns_order FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_order_returns_requester FOREIGN KEY (requested_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT fk_order_returns_preparer FOREIGN KEY (prepared_by)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_order_returns_confirmer FOREIGN KEY (confirmed_by)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_order_returns_status CHECK (status IN ('REQUESTED', 'PREPARED', 'REFUNDING', 'REFUNDED')),
  CONSTRAINT ck_order_returns_reason CHECK (reason IN ('DEFECT', 'NOT_AS_DESCRIBED', 'CHANGED_MIND')),
  CONSTRAINT ck_order_returns_restock CHECK (restock IS NULL OR restock IN (0, 1)),
  -- T2.1: the operator who prepares never confirms the same request.
  CONSTRAINT ck_order_returns_dual CHECK (prepared_by IS NULL OR confirmed_by IS NULL OR prepared_by <> confirmed_by),
  -- From PREPARED on the request has its amount, its restock decision and its preparer.
  CONSTRAINT ck_order_returns_prepared CHECK (
    status = 'REQUESTED'
    OR (refund_mxn_cents > 0 AND restock IS NOT NULL AND prepared_by IS NOT NULL AND prepared_at IS NOT NULL)
  ),
  -- From REFUNDING on someone confirmed it.
  CONSTRAINT ck_order_returns_confirmed CHECK (
    status IN ('REQUESTED', 'PREPARED')
    OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_return_items (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  return_id INT UNSIGNED NOT NULL,
  order_item_id INT UNSIGNED NOT NULL,
  quantity SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_order_return_items_line (return_id, order_item_id),
  KEY ix_order_return_items_line (order_item_id),
  CONSTRAINT fk_order_return_items_return FOREIGN KEY (return_id)
    REFERENCES order_returns (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_order_return_items_line FOREIGN KEY (order_item_id)
    REFERENCES order_items (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_order_return_items_quantity CHECK (quantity BETWEEN 1 AND 99)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO permissions (id, module, description) VALUES
  ('returns:view', 'returns', 'Ver el tablero de devoluciones y sus partidas.'),
  ('returns:prepare', 'returns', 'Evaluar una devolución y preparar su reembolso: monto y reingreso a inventario.'),
  ('returns:confirm', 'returns', 'Confirmar y ejecutar un reembolso preparado por otra persona (cuatro ojos).');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r JOIN permissions p ON p.id IN ('returns:view', 'returns:prepare')
  WHERE r.id IN ('owner', 'admin', 'staff_orders');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
  SELECT r.id, 'returns:confirm' FROM roles r WHERE r.id IN ('owner', 'admin');
