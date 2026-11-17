-- 013 · V0.24.0 · FC 054 F0 · 2026-11-17 · The link between an account and its Stripe customer.
--
-- To let a buyer keep cards for the next purchase, Stripe needs one `Customer` per account; the
-- cards belong to that customer and live only at Stripe. This table holds the link and nothing
-- else: the id of the customer (`cus_…`). No card number (PAN), no security code (CVV), no
-- expiry, no brand and no last four digits are ever written to this database (PCI DSS SAQ A):
-- the API asks Stripe for them each time they are shown.
--
-- One account has at most one customer (the account id is the primary key) and one customer
-- belongs to one account (unique). The link goes with the account (ON DELETE CASCADE): when an
-- account is deleted, the customer id is forgotten here; the API detaches the cards at Stripe.
-- The id is a reference of the processor, not personal data, so it is kept in the clear.
--
-- Idempotent (DB_LAW): CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS user_stripe_customers (
  user_id CHAR(36) NOT NULL,
  stripe_customer_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  UNIQUE KEY ux_user_stripe_customers_customer (stripe_customer_id),
  CONSTRAINT fk_user_stripe_customers_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
