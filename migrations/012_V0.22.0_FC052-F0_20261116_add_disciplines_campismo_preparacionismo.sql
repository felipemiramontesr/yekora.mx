-- 012 · V0.22.0 · FC 052 F0 · 2026-11-16 · Two new disciplines: Camping and Prepping.
--
-- Ana Karen asked for them (Ω, 2026-11-16). A discipline is a reference row of `categories`
-- (ADR 0007: data, never a list written into the schema), so this migration is data only: the
-- schema, and with it the fingerprint of production, does not change. The slugs are the ones the
-- site uses as dictionary key, pictogram key and anchor (app/i18n.ts).
--
-- Idempotent (DB_LAW): INSERT IGNORE on the unique slug. It must reach production before the code
-- that offers the disciplines: a product form that lists a discipline the database does not hold
-- refuses to create products with it (CAT_REFERENCE_INVALID).

INSERT IGNORE INTO categories (slug, name_es, name_en, sort_order, is_active) VALUES
  ('campismo', 'Campismo', 'Camping', 6, 1),
  ('preparacionismo', 'Preparacionismo', 'Prepping', 7, 1);
