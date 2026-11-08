-- 007 · V0.13.0 · FC 042 F0 · 2026-11-08 · Password reset tokens.
--
-- One row per reset link mailed (T0.1, T2.2): the token itself travels only in the link; the row
-- keeps its SHA-256 (token_hash, 64 lowercase hex), so a copy of the database opens no account.
-- A link lasts 15 minutes (expires_at, written by the API in UTC) and serves once (consumed_at);
-- the lookup index answers "this hash, still valid, not spent" without a scan.
--
-- user_id follows users.id (CHAR(36), migration 004); deleting a user deletes their links
-- (CASCADE), as user_sessions does.
--
-- Business times use DATETIME in UTC, written by the API (same rule as 003 to 006).
--
-- Idempotent (DB_LAW): CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_password_reset_tokens_hash (token_hash),
  KEY idx_token_lookup (token_hash, expires_at, consumed_at),
  KEY ix_password_reset_tokens_user (user_id),
  CONSTRAINT fk_password_reset_tokens_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT ck_password_reset_tokens_hash CHECK (token_hash REGEXP '^[0-9a-f]{64}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
