-- 003 · V0.8.0 · FC 012 F0 · 2026-10-21 · Orders and payments (ADR 0003, ADR 0007, ADR 0009).
--
-- Guest checkout with hosted payments (PCI SAQ A): no card data is ever stored. The buyer
-- chooses the payment method in Yekora's checkout (Ω, 112_AN); each method belongs to one
-- processor and carries how long the stock stays reserved, as data that can be tuned.
--
-- Personal data (name, e-mail, phone, address) is stored only encrypted by the API
-- (AES-256-GCM with CHECKOUT_PII_KEY); the e-mail also as an HMAC for lookups, and the order
-- access token only as an HMAC (ORDER_TOKEN_PEPPER). Processor webhooks are recorded once per
-- (processor, event id) for idempotency, without their payloads (they can carry payer data).
--
-- Business times use DATETIME (UTC, written by the API): a MariaDB TIMESTAMP column without an
-- explicit default may silently auto-update, which an expiry or payment time must never do.
--
-- Sandbox in production (Ω, 092_AN §2-§3): orders, events, products, shipping rules and the
-- shipping configuration carry is_test, so the go-live gate (T1.4 C) can assert with SQL that
-- no test data is left.
--
-- Idempotent (DB_LAW): CREATE TABLE IF NOT EXISTS, INSERT IGNORE by unique code, and
-- ADD COLUMN / ADD CONSTRAINT IF NOT EXISTS.

-- Order life cycle (FC 012 §3). Ids are fixed: the API and the transition rules refer to them.
CREATE TABLE IF NOT EXISTS order_statuses (
  id SMALLINT UNSIGNED NOT NULL,
  code VARCHAR(32) NOT NULL,
  name_es VARCHAR(80) NOT NULL,
  name_en VARCHAR(80) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_order_statuses_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_processors (
  id SMALLINT UNSIGNED NOT NULL,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(80) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payment_processors_code (code),
  CONSTRAINT ck_payment_processors_active CHECK (is_active IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- What the buyer picks in the checkout. hold_minutes is how long the order keeps its stock;
-- the processor's own expiry is always set shorter (FC 012: no late payment by construction).
CREATE TABLE IF NOT EXISTS payment_methods (
  id SMALLINT UNSIGNED NOT NULL,
  code VARCHAR(32) NOT NULL,
  processor_id SMALLINT UNSIGNED NOT NULL,
  name_es VARCHAR(80) NOT NULL,
  name_en VARCHAR(80) NOT NULL,
  hold_minutes INT UNSIGNED NOT NULL,
  sort_order SMALLINT UNSIGNED NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payment_methods_code (code),
  CONSTRAINT fk_payment_methods_processor FOREIGN KEY (processor_id)
    REFERENCES payment_processors (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- Room for the 30-minute margin of the processor's expiry.
  CONSTRAINT ck_payment_methods_hold CHECK (hold_minutes > 30),
  CONSTRAINT ck_payment_methods_active CHECK (is_active IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- Random, never sequential (A01): what the buyer sees, e.g. YEK-2026-7F3K9QX2.
  order_number VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status_id SMALLINT UNSIGNED NOT NULL,
  payment_method_id SMALLINT UNSIGNED NOT NULL,
  -- Checkout session or preference id at the processor, once created.
  processor_reference VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
  -- The processor's payment that settled it (Stripe session, Mercado Pago payment): T1.4 S
  -- tells a retry of that same payment (ALREADY_PAID) from a second one (alert).
  payment_resource_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
  shipping_zone_id SMALLINT UNSIGNED NOT NULL,
  -- Amounts in MXN cents with VAT included (073_AN), as quoted by the server (FC 011).
  items_base_mxn_cents INT UNSIGNED NOT NULL,
  items_tax_mxn_cents INT UNSIGNED NOT NULL,
  items_total_mxn_cents INT UNSIGNED NOT NULL,
  shipping_base_mxn_cents INT UNSIGNED NOT NULL,
  shipping_tax_mxn_cents INT UNSIGNED NOT NULL,
  shipping_total_mxn_cents INT UNSIGNED NOT NULL,
  total_mxn_cents INT UNSIGNED NOT NULL,
  currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'MXN',
  -- Personal data: ciphertext only (YekoraALE), never plain text.
  customer_name_enc VARBINARY(1024) NOT NULL,
  customer_email_enc VARBINARY(1024) NOT NULL,
  customer_phone_enc VARBINARY(256) NOT NULL,
  shipping_address_enc VARBINARY(2048) NOT NULL,
  customer_email_hmac BINARY(32) NOT NULL,
  access_token_hash BINARY(32) NOT NULL,
  privacy_consent_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  paid_at DATETIME NULL,
  is_test TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_orders_number (order_number),
  UNIQUE KEY uq_orders_processor_reference (processor_reference),
  UNIQUE KEY uq_orders_payment_resource (payment_resource_id),
  UNIQUE KEY uq_orders_access_token (access_token_hash),
  KEY ix_orders_status_expiry (status_id, expires_at),
  KEY ix_orders_email_hmac (customer_email_hmac),
  CONSTRAINT fk_orders_status FOREIGN KEY (status_id)
    REFERENCES order_statuses (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_orders_method FOREIGN KEY (payment_method_id)
    REFERENCES payment_methods (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_orders_zone FOREIGN KEY (shipping_zone_id)
    REFERENCES shipping_zones (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_orders_number CHECK (order_number REGEXP '^YEK-[0-9]{4}-[0-9A-Z]{8}$'),
  CONSTRAINT ck_orders_currency CHECK (currency = 'MXN'),
  CONSTRAINT ck_orders_items_split CHECK (
    items_base_mxn_cents + items_tax_mxn_cents = items_total_mxn_cents
  ),
  CONSTRAINT ck_orders_shipping_split CHECK (
    shipping_base_mxn_cents + shipping_tax_mxn_cents = shipping_total_mxn_cents
  ),
  CONSTRAINT ck_orders_total CHECK (
    total_mxn_cents = items_total_mxn_cents + shipping_total_mxn_cents AND total_mxn_cents > 0
  ),
  CONSTRAINT ck_orders_expiry CHECK (expires_at > privacy_consent_at),
  CONSTRAINT ck_orders_paid_at CHECK ((status_id IN (2, 5)) = (paid_at IS NOT NULL) OR status_id = 6),
  CONSTRAINT ck_orders_payment_resource CHECK (status_id NOT IN (2, 5) OR payment_resource_id IS NOT NULL),
  CONSTRAINT ck_orders_test CHECK (is_test IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Lines as sold: SKU and prices copied at purchase time, so a later catalog change never
-- rewrites a past order.
CREATE TABLE IF NOT EXISTS order_items (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id INT UNSIGNED NOT NULL,
  product_id INT UNSIGNED NOT NULL,
  sku VARCHAR(64) NOT NULL,
  quantity SMALLINT UNSIGNED NOT NULL,
  unit_price_mxn_cents INT UNSIGNED NOT NULL,
  line_base_mxn_cents INT UNSIGNED NOT NULL,
  line_tax_mxn_cents INT UNSIGNED NOT NULL,
  line_total_mxn_cents INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_order_items_product (order_id, product_id),
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_order_items_product FOREIGN KEY (product_id)
    REFERENCES products (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_order_items_quantity CHECK (quantity BETWEEN 1 AND 99),
  CONSTRAINT ck_order_items_price CHECK (unit_price_mxn_cents > 0),
  CONSTRAINT ck_order_items_total CHECK (line_total_mxn_cents = unit_price_mxn_cents * quantity),
  CONSTRAINT ck_order_items_split CHECK (
    line_base_mxn_cents + line_tax_mxn_cents = line_total_mxn_cents
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per processor event, ever (idempotency key: processor + event id). No payload is
-- kept; only what the reconciliation decided. resulting_status_id is the transition applied,
-- if any; is_alert marks a mismatch or a late payment for review.
CREATE TABLE IF NOT EXISTS payment_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  processor_id SMALLINT UNSIGNED NOT NULL,
  event_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  order_id INT UNSIGNED NULL,
  processor_status VARCHAR(40) NULL,
  amount_mxn_cents INT UNSIGNED NULL,
  currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NULL,
  resulting_status_id SMALLINT UNSIGNED NULL,
  is_alert TINYINT(1) NOT NULL DEFAULT 0,
  is_test TINYINT(1) NOT NULL DEFAULT 0,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payment_events_idempotency (processor_id, event_id),
  KEY ix_payment_events_order (order_id),
  CONSTRAINT fk_payment_events_processor FOREIGN KEY (processor_id)
    REFERENCES payment_processors (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_payment_events_order FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_payment_events_status FOREIGN KEY (resulting_status_id)
    REFERENCES order_statuses (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_payment_events_alert CHECK (is_alert IN (0, 1)),
  CONSTRAINT ck_payment_events_test CHECK (is_test IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Reference data.
INSERT IGNORE INTO order_statuses (id, code, name_es, name_en) VALUES
  (1, 'PENDING_PAYMENT', 'Pendiente de pago', 'Awaiting payment'),
  (2, 'PAID', 'Pagado', 'Paid'),
  (3, 'EXPIRED', 'Vencido', 'Expired'),
  (4, 'CANCELLED', 'Cancelado', 'Cancelled'),
  (5, 'REFUNDED', 'Reembolsado', 'Refunded'),
  (6, 'NEEDS_REVIEW', 'En revisión', 'Under review');

INSERT IGNORE INTO payment_processors (id, code, name) VALUES
  (1, 'STRIPE', 'Stripe'),
  (2, 'MERCADO_PAGO', 'Mercado Pago');

-- Hold times (112_AN): card and balance 60 min (Stripe sessions live at least 30 min, plus the
-- 30-min margin); OXXO 72 h (the voucher may live until 23:59 of the next day, ~48 h); SPEI 24 h.
INSERT IGNORE INTO payment_methods (id, code, processor_id, name_es, name_en, hold_minutes, sort_order) VALUES
  (1, 'CARD', 1, 'Tarjeta de crédito o débito', 'Credit or debit card', 60, 1),
  (2, 'OXXO', 1, 'Efectivo en OXXO', 'Cash at OXXO', 4320, 2),
  (3, 'SPEI', 2, 'Transferencia SPEI', 'SPEI bank transfer', 1440, 3),
  (4, 'MERCADO_PAGO_BALANCE', 2, 'Saldo de Mercado Pago', 'Mercado Pago balance', 60, 4);

-- Stock reserved by pending orders (FC 012 §2), never above the stock; plus the sandbox marker.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS reserved_stock INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_test TINYINT(1) NOT NULL DEFAULT 0,
  ADD CONSTRAINT IF NOT EXISTS ck_products_reserved CHECK (reserved_stock <= stock),
  ADD CONSTRAINT IF NOT EXISTS ck_products_test CHECK (is_test IN (0, 1));

ALTER TABLE shipping_rules
  ADD COLUMN IF NOT EXISTS is_test TINYINT(1) NOT NULL DEFAULT 0,
  ADD CONSTRAINT IF NOT EXISTS ck_shipping_rules_test CHECK (is_test IN (0, 1));

ALTER TABLE shipping_configs
  ADD COLUMN IF NOT EXISTS is_test TINYINT(1) NOT NULL DEFAULT 0,
  ADD CONSTRAINT IF NOT EXISTS ck_shipping_configs_test CHECK (is_test IN (0, 1));
