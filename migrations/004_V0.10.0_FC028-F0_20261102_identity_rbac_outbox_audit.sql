-- 004 · V0.10.0 · FC 028 F0 · 2026-11-02 · Identity, RBAC, 2FA, outbox and audit (ADR 0011–0014).
--
-- One login for buyers and staff (143_AN B1–B5, 249_AN §1.1): users with roles, and roles that
-- are sets of permissions held in tables, so a new role needs no deploy. `admin` is the union of
-- every permission, written by the INSERT … SELECT below, never by a copied list.
--
-- Secrets never land in clear (FC 028 T2.1–T2.2): passwords as Argon2id, session tokens and
-- one-time codes as keyed SHA-256, TOTP secrets encrypted with TOTP_ENCRYPTION_KEY
-- (`v1:<iv>:<tag>:<ciphertext>`). Mail leaves only through outbox_events (ADR 0013). audit_log
-- records what staff changed, without personal data in clear (T2.5).
--
-- orders gains a nullable user_id: a guest order keeps working, and a registered buyer can claim
-- past orders by the e-mail HMAC (FC 012). Deleting a user never deletes an order (SET NULL).
--
-- Business times use DATETIME in UTC, written by the API (same rule as 003).
--
-- Idempotent (DB_LAW): CREATE TABLE IF NOT EXISTS, INSERT IGNORE, ADD COLUMN / ADD CONSTRAINT
-- IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  email_verified_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  CONSTRAINT ck_users_active CHECK (is_active IN (0, 1)),
  CONSTRAINT ck_users_hash CHECK (password_hash LIKE '$argon2id$%')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Roles are slugs the code refers to; their permissions are data.
CREATE TABLE IF NOT EXISTS roles (
  id VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  CONSTRAINT ck_roles_active CHECK (is_active IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS permissions (
  id VARCHAR(100) NOT NULL,
  module VARCHAR(50) NOT NULL,
  description VARCHAR(255) NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id VARCHAR(50) NOT NULL,
  permission_id VARCHAR(100) NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  KEY ix_role_permissions_permission (permission_id),
  CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id)
    REFERENCES roles (id) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_id)
    REFERENCES permissions (id) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_roles (
  user_id CHAR(36) NOT NULL,
  role_id VARCHAR(50) NOT NULL,
  PRIMARY KEY (user_id, role_id),
  KEY ix_user_roles_role (role_id),
  CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id)
    REFERENCES roles (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A session is found by the SHA-256 of its token; the token itself only lives in the cookie.
CREATE TABLE IF NOT EXISTS user_sessions (
  id CHAR(64) NOT NULL,
  user_id CHAR(36) NOT NULL,
  refresh_token_hash CHAR(64) NOT NULL,
  ip_address VARCHAR(45) NULL,
  user_agent TEXT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_user_sessions_user (user_id),
  KEY ix_user_sessions_expiry (expires_at),
  CONSTRAINT fk_user_sessions_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS two_factor_auth (
  user_id CHAR(36) NOT NULL,
  totp_secret_encrypted TEXT NULL,
  is_totp_enabled TINYINT(1) NOT NULL DEFAULT 0,
  is_email_2fa_enabled TINYINT(1) NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_two_factor_auth_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT ck_two_factor_auth_totp CHECK (is_totp_enabled IN (0, 1)),
  CONSTRAINT ck_two_factor_auth_email CHECK (is_email_2fa_enabled IN (0, 1)),
  CONSTRAINT ck_two_factor_auth_secret CHECK (
    totp_secret_encrypted IS NULL OR totp_secret_encrypted LIKE 'v_:%'
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS two_factor_backup_codes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id CHAR(36) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  is_used TINYINT(1) NOT NULL DEFAULT 0,
  used_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_two_factor_backup_codes_hash (user_id, code_hash),
  CONSTRAINT fk_two_factor_backup_codes_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT ck_two_factor_backup_codes_used CHECK (
    (is_used = 0 AND used_at IS NULL) OR (is_used = 1 AND used_at IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS two_factor_challenges (
  id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  challenge_type VARCHAR(20) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_two_factor_challenges_user (user_id),
  CONSTRAINT fk_two_factor_challenges_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT ck_two_factor_challenges_type CHECK (challenge_type IN ('EMAIL', 'TOTP')),
  CONSTRAINT ck_two_factor_challenges_attempts CHECK (attempts <= 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ADR 0013: a business transaction inserts its mail here; the dispatcher sends it afterwards.
CREATE TABLE IF NOT EXISTS outbox_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_type VARCHAR(100) NOT NULL,
  payload LONGTEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  retry_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  max_retries TINYINT UNSIGNED NOT NULL DEFAULT 5,
  next_retry_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME NULL,
  error_message TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_outbox_pending (status, next_retry_at),
  CONSTRAINT ck_outbox_events_status CHECK (
    status IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED')
  ),
  CONSTRAINT ck_outbox_events_retries CHECK (retry_count <= max_retries),
  CONSTRAINT ck_outbox_events_payload CHECK (JSON_VALID(payload))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id CHAR(36) NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(100) NOT NULL,
  before_state LONGTEXT NULL,
  after_state LONGTEXT NULL,
  ip_address VARCHAR(45) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_audit_log_user (user_id),
  KEY ix_audit_log_entity (entity_type, entity_id),
  CONSTRAINT fk_audit_log_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT ck_audit_log_before CHECK (before_state IS NULL OR JSON_VALID(before_state)),
  CONSTRAINT ck_audit_log_after CHECK (after_state IS NULL OR JSON_VALID(after_state))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A guest order keeps user_id NULL; deleting a user keeps the order (T2.7).
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS user_id CHAR(36) NULL AFTER id,
  ADD CONSTRAINT fk_orders_user FOREIGN KEY IF NOT EXISTS (user_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE RESTRICT;

-- System catalog (ADR 0007): the four base roles of 143_AN B1.
INSERT IGNORE INTO roles (id, name, description) VALUES
  ('admin', 'Administrador', 'Todos los permisos, más usuarios y configuración.'),
  ('staff_orders', 'Staff · pedidos y envíos', 'Consulta y opera pedidos.'),
  ('staff_catalog', 'Staff · catálogo', 'Opera productos, variantes y medios.'),
  ('customer', 'Cliente', 'Su cuenta y sus pedidos.');

-- The permission is the unit (143_AN B1). FC 028 opens the ones its routes need.
INSERT IGNORE INTO permissions (id, module, description) VALUES
  ('account:self', 'account', 'Ver y editar la propia cuenta y los propios pedidos.'),
  ('orders:read', 'orders', 'Consultar todos los pedidos, sus partidas y sus eventos de pago.'),
  ('catalog:write', 'catalog', 'Crear y editar productos, variantes y medios.'),
  ('users:manage', 'users', 'Consultar usuarios y asignar roles.'),
  ('audit:read', 'audit', 'Consultar la bitácora de auditoría.');

INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('customer', 'account:self'),
  ('staff_orders', 'account:self'),
  ('staff_orders', 'orders:read'),
  ('staff_catalog', 'account:self'),
  ('staff_catalog', 'catalog:write');

-- admin = the union of every permission, so a permission added later reaches it here.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
  SELECT 'admin', id FROM permissions;
