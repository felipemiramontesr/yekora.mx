-- 021 · V0.50.0 · FC 077 F0 · 2026-11-26 · Invoicing: fiscal profiles, requests and CFDI files.
--
-- The store does not stamp invoices (T0.1): an external system does, and the store keeps what was
-- asked and what came back (K-81). This migration adds:
--   customer_fiscal_profiles  the fiscal data a signed-in buyer saves, one per account;
--   invoice_requests          one request per order at a time (active_marker is 1 while PENDING or
--                             COMPLETED and NULL after, under a unique key, T0.4);
--   order_invoices            the XML and PDF inside the database (T0.2), because the API's
--                             release folder is replaced on every deploy; one active invoice per
--                             order, and a SAT folio never twice, cancelled or not;
--   the permissions invoices:read, invoices:upload and invoices:request.
--
-- The legal name, the postal code and the e-mail are stored only as ciphertext (T2.4).
-- Idempotent (DB_LAW): CREATE TABLE IF NOT EXISTS and INSERT IGNORE.

CREATE TABLE IF NOT EXISTS customer_fiscal_profiles (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id CHAR(36) NOT NULL,
  rfc VARCHAR(13) NOT NULL,
  legal_name_enc VARBINARY(512) NOT NULL,
  tax_system VARCHAR(8) NOT NULL,
  postal_code_enc VARBINARY(128) NOT NULL,
  default_cfdi_use VARCHAR(8) NOT NULL DEFAULT 'G03',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_fiscal_user (user_id),
  CONSTRAINT fk_customer_fiscal_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT ck_customer_fiscal_rfc CHECK (rfc REGEXP '^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$'),
  CONSTRAINT ck_customer_fiscal_tax_system CHECK (tax_system REGEXP '^[0-9]{3}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoice_requests (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id INT UNSIGNED NOT NULL,
  -- NULL for a counter sale or a guest purchase: the staff asked on the buyer's behalf.
  user_id CHAR(36) NULL,
  rfc VARCHAR(13) NOT NULL,
  legal_name_enc VARBINARY(512) NOT NULL,
  tax_system VARCHAR(8) NOT NULL,
  postal_code_enc VARBINARY(128) NOT NULL,
  cfdi_use VARCHAR(8) NOT NULL,
  email_for_invoice_enc VARBINARY(512) NOT NULL,
  email_for_invoice_hmac CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
  rejection_reason VARCHAR(255) NULL,
  cancellation_reason VARCHAR(255) NULL,
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  rejected_at DATETIME NULL,
  cancelled_at DATETIME NULL,
  fulfilled_by_user_id CHAR(36) NULL,
  cancelled_by_user_id CHAR(36) NULL,
  active_marker TINYINT GENERATED ALWAYS AS (IF(status IN ('PENDING', 'COMPLETED'), 1, NULL)) VIRTUAL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_invoice_requests_active_order (order_id, active_marker),
  KEY ix_invoice_requests_status (status, requested_at),
  KEY ix_invoice_requests_rfc (rfc),
  CONSTRAINT fk_invoice_requests_order FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_invoice_requests_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT fk_invoice_requests_fulfiller FOREIGN KEY (fulfilled_by_user_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_invoice_requests_canceller FOREIGN KEY (cancelled_by_user_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_invoice_requests_rfc CHECK (rfc REGEXP '^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$'),
  CONSTRAINT ck_invoice_requests_status CHECK (status IN ('PENDING', 'COMPLETED', 'REJECTED', 'CANCELLED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_invoices (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  invoice_request_id INT UNSIGNED NOT NULL,
  order_id INT UNSIGNED NOT NULL,
  uuid CHAR(36) NOT NULL,
  rfc_issuer VARCHAR(13) NOT NULL,
  rfc_receiver VARCHAR(13) NOT NULL,
  total_cents INT UNSIGNED NOT NULL,
  stamped_at DATETIME NOT NULL,
  xml_filename VARCHAR(255) NOT NULL,
  xml_data MEDIUMBLOB NOT NULL,
  xml_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  pdf_filename VARCHAR(255) NOT NULL,
  pdf_data MEDIUMBLOB NOT NULL,
  pdf_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  active_marker TINYINT GENERATED ALWAYS AS (IF(status = 'ACTIVE', 1, NULL)) VIRTUAL,
  uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  uploaded_by_user_id CHAR(36) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_order_invoices_uuid (uuid),
  UNIQUE KEY uq_order_invoices_order_active (order_id, active_marker),
  KEY ix_order_invoices_request (invoice_request_id),
  CONSTRAINT fk_order_invoices_request FOREIGN KEY (invoice_request_id)
    REFERENCES invoice_requests (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_order_invoices_order FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_order_invoices_uploader FOREIGN KEY (uploaded_by_user_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_order_invoices_uuid CHECK (uuid REGEXP '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  CONSTRAINT ck_order_invoices_status CHECK (status IN ('ACTIVE', 'SUPERSEDED', 'CANCELLED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO permissions (id, module, description) VALUES
  ('invoices:read', 'invoices', 'Consultar solicitudes de factura y descargar sus archivos.'),
  ('invoices:upload', 'invoices', 'Cargar, rechazar y anular facturas.'),
  ('invoices:request', 'invoices', 'Pedir factura a nombre de quien compró sin cuenta.');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r JOIN permissions p ON p.id IN ('invoices:read', 'invoices:request')
  WHERE r.id IN ('owner', 'admin', 'staff_orders');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
  SELECT r.id, 'invoices:upload' FROM roles r WHERE r.id IN ('owner', 'admin');
