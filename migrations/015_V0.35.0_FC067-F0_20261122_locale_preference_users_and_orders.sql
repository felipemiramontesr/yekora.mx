-- 015 · V0.35.0 · FC 067 F0 · 2026-11-22 · The language of the mail: a preference on the account and a locale on the order.
--
-- A message is written in one language (FC 065, FC 066), and until now nothing said which one: the
-- account kept no preference and the order no language, so every mail went out in Mexican Spanish.
-- This migration adds what the dispatcher needs to choose (FC 067 T1.1):
--   users.preferred_locale  the language an account chose at sign-up or in «Mi información» (Ω,
--                           2026-11-22: like Drupal's preferred language);
--   orders.locale           the language of the page the buyer bought from, which is what a guest
--                           has, since a guest has no account.
-- Both default to 'es-MX', so every account and order that exists keeps today's behaviour (T2.2)
-- and no column is ever NULL. A CHECK keeps them to the official catalog: es-MX or en (T1.2).
--
-- Idempotent (DB_LAW): ADD COLUMN IF NOT EXISTS and ADD CONSTRAINT IF NOT EXISTS, so a second run
-- changes nothing. Both ALTERs add a column with a constant default: MariaDB does not rewrite the
-- rows of a table for it, so nothing is locked for long.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS preferred_locale VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'es-MX',
  ADD CONSTRAINT IF NOT EXISTS ck_users_preferred_locale CHECK (preferred_locale IN ('es-MX', 'en'));

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS locale VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'es-MX',
  ADD CONSTRAINT IF NOT EXISTS ck_orders_locale CHECK (locale IN ('es-MX', 'en'));
