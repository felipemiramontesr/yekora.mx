-- 019 · V0.45.0 · FC 075 F0 · 2026-11-26 · Tickets and approvals of the payments mode switch.
--
-- The mode of the payments (sandbox or live) is declared in the environment and checked at start
-- (FC 070). The switch does not flip it in a running process: it records an approval, and the start
-- of the API demands it (FC 075, decision of the owner). This table is the one store of that:
-- a ticket asked by the owner or an administrator, confirmed by the owner alone with the
-- canonical phrase and the second factor, with at most 3 attempts; the confirmation gives 24 hours
-- to activate it (approval_expires_at = consumed_at + 86400 s) and the first start in live records
-- activated_at. No secret of a processor and no one-time code is ever stored here.
--
-- The values of target_mode and status are checked by constraints rather than by the column type
-- the contract named (ADR 0007 allows no such type). The user columns are CHAR(36), the type of users.id (the contract wrote INT UNSIGNED, which no
-- foreign key to users could use).
--
-- Idempotent (DB_LAW): CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS payments_mode_tickets (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  challenge_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  -- 'sandbox' or 'live', with a check instead of a column type of fixed values (ADR 0007).
  target_mode VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  requested_by CHAR(36) NOT NULL,
  reason VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  consumed_at DATETIME NULL,
  confirmed_by CHAR(36) NULL,
  approval_expires_at DATETIME NULL,
  activated_at DATETIME NULL,
  status VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
  PRIMARY KEY (id),
  UNIQUE KEY uq_payments_mode_tickets_challenge (challenge_id),
  KEY ix_payments_mode_tickets_consumed (status, consumed_at),
  CONSTRAINT fk_payments_mode_tickets_requester FOREIGN KEY (requested_by)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_payments_mode_tickets_confirmer FOREIGN KEY (confirmed_by)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_payments_mode_tickets_target CHECK (target_mode IN ('sandbox', 'live')),
  CONSTRAINT ck_payments_mode_tickets_status CHECK (status IN ('PENDING', 'CONSUMED', 'EXPIRED', 'FAILED')),
  CONSTRAINT ck_payments_mode_tickets_attempts CHECK (attempts <= 3),
  CONSTRAINT ck_payments_mode_tickets_consumed CHECK (
    status <> 'CONSUMED'
    OR (consumed_at IS NOT NULL AND confirmed_by IS NOT NULL AND approval_expires_at IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
