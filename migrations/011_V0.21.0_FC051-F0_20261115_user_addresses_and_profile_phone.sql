-- 011 · V0.21.0 · FC 051 F0 · 2026-11-15 · The data an account keeps to ship and charge: a phone
-- and up to five delivery addresses, one of them the default.
--
-- Until now an account held a single postal code (migration 009), given at sign-up and never
-- editable. The delivery address becomes the only source of that code (Ω, 2026-11-15): an account
-- keeps a book of addresses, the default one is what the header shows, and the postal code and
-- state columns of `users` are retired. Nothing is converted: the only customer test account is
-- deleted before this runs and the owner's account has neither a postal code nor an address.
--
-- Personal data (LFPDPPP) is stored only as AES-256-GCM ciphertext made with CHECKOUT_PII_KEY
-- (`0x01 · IV · ciphertext · tag`), bound to the account and to the row it belongs to:
--   - users.phone_enc            : the phone, bound to «<user id>|user_phone»;
--   - user_addresses.address_enc : the address as one sealed JSON, bound to
--                                  «<user id>|<address id>|user_address».
-- The state is NOT personal data and stays in the clear as a reference to the catalog of states
-- the shipping engine already prices (ADR 0007: a foreign key to shipping_zones.code, no list
-- written into the schema); it lets the cart be quoted without opening any ciphertext.
--
-- `is_complete` tells an address that only holds a postal code (the one given at sign-up) from one
-- that can ship an order. The default address is a pointer in `users` (one source of truth, never
-- two rows marked at once): it is cleared if the address goes (ON DELETE SET NULL). A limit of
-- five addresses per account is enforced by the API, in the transaction that inserts. The creation
-- time keeps microseconds: addresses added in the same second still come back in the order they
-- were added, and «the newest left» is well defined.
--
-- Idempotent (DB_LAW): IF NOT EXISTS / ADD ... IF NOT EXISTS / DROP ... IF EXISTS.

CREATE TABLE IF NOT EXISTS user_addresses (
  id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  state_code CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  is_complete TINYINT(1) NOT NULL DEFAULT 0,
  address_enc VARBINARY(2048) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_user_addresses_user (user_id, created_at),
  CONSTRAINT fk_user_addresses_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_user_addresses_state FOREIGN KEY (state_code)
    REFERENCES shipping_zones (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_user_addresses_complete CHECK (is_complete IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone_enc VARBINARY(128) NULL AFTER full_name,
  ADD COLUMN IF NOT EXISTS default_address_id CHAR(36) NULL AFTER phone_enc;

ALTER TABLE users
  ADD CONSTRAINT fk_users_default_address FOREIGN KEY IF NOT EXISTS (default_address_id)
    REFERENCES user_addresses (id) ON DELETE SET NULL ON UPDATE RESTRICT;

-- The postal code and the state of migration 009 are retired: the address is their only source.
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS fk_users_shipping_state,
  DROP CONSTRAINT IF EXISTS ck_users_shipping_pair;

ALTER TABLE users
  DROP COLUMN IF EXISTS shipping_state,
  DROP COLUMN IF EXISTS shipping_postal_code_enc;
