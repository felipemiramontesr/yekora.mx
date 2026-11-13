-- 009 · V0.16.0 · FC 047 F0 · 2026-11-13 · The delivery postal code of an account.
--
-- The buyer gives it with their delivery address when creating the account (Ω, 2026-11-13). It is
-- personal data (LFPDPPP): it is stored only as AES-256-GCM ciphertext made with CHECKOUT_PII_KEY
-- (`0x01 · IV · ciphertext · tag`, bound to the account), never in the browser. The state derived
-- from it is informational: it prefills, and never prices a shipment without the buyer confirming
-- the state at checkout (FC 047 T2.3).
--
-- The state is a reference, not a list written into the schema (ADR 0007): a foreign key to
-- shipping_zones.code, the catalog of states the shipping engine already prices. The column has
-- the same character set and collation as that code, which MariaDB requires of a foreign key.
-- A state added or retired later is a row, never an ALTER.
--
-- Both columns are nullable: an account created without a postal code, and every account that
-- already exists, keeps working. They are set together or not at all.
--
-- Idempotent (DB_LAW): ADD COLUMN / ADD CONSTRAINT IF NOT EXISTS.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS shipping_postal_code_enc VARBINARY(64) NULL AFTER full_name,
  ADD COLUMN IF NOT EXISTS shipping_state CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER shipping_postal_code_enc;

ALTER TABLE users
  ADD CONSTRAINT IF NOT EXISTS ck_users_shipping_pair
    CHECK ((shipping_postal_code_enc IS NULL) = (shipping_state IS NULL)),
  ADD CONSTRAINT fk_users_shipping_state FOREIGN KEY IF NOT EXISTS (shipping_state)
    REFERENCES shipping_zones (code) ON DELETE RESTRICT ON UPDATE RESTRICT;
