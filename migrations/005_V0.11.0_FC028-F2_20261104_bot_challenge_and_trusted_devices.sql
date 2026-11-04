-- 005 · V0.11.0 · FC 028 F2 (Enmienda 1) · 2026-11-04 · Anti-bot challenge and trusted devices.
--
-- E1 (T1.4, T2.8b): every solved ALTCHA-format challenge is spent once. Its SHA-256 goes in
-- auth_challenge_nonces with the challenge's own expiry; a second insert of the same hash fails
-- on the primary key, so a replay is refused by the database itself. Expired rows are pruned by
-- the outbox sweep (no other process).
--
-- E2 (T2.9a–d): a buyer may ask the site to remember a device for 30 days. The browser keeps a
-- random token in the __Host-yekora_device cookie; the database keeps only its SHA-256, bound to
-- the user, with its expiry. Deleting the user deletes the devices (CASCADE). Never for staff or
-- admin: the API refuses it by role (T2.9b).
--
-- Business times use DATETIME in UTC, written by the API (same rule as 003 and 004).
--
-- Idempotent (DB_LAW): CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS auth_challenge_nonces (
  nonce_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (nonce_hash),
  KEY idx_expires (expires_at),
  CONSTRAINT ck_auth_challenge_nonces_hash CHECK (CHAR_LENGTH(nonce_hash) = 64)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_trusted_devices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id CHAR(36) NOT NULL,
  device_token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  user_agent TEXT NULL,
  ip_address VARCHAR(45) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_trusted_devices_token (device_token_hash),
  KEY ix_user_trusted_devices_user (user_id),
  KEY ix_user_trusted_devices_expires (expires_at),
  CONSTRAINT fk_trusted_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT ck_user_trusted_devices_hash CHECK (CHAR_LENGTH(device_token_hash) = 64)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
