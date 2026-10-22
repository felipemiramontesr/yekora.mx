-- FC 015 F0 · Verification counters of migration 001 (catalog schema, FC 008).
-- Aggregates only, never data rows; read-only. Run by scripts/migrateDb.ts after 001 is applied
-- or found registered, and printed in the workflow summary. Not a migration: its name does not
-- match MIGRATION_NAME, so a normal run never applies it (as NNN_down.sql).
-- Expected after 001: disciplines 5, levels 4; products is the live count.
SELECT
  (SELECT COUNT(*) FROM categories
     WHERE slug IN ('senderismo', 'montana', 'escalada', 'canonismo', 'trail-running')) AS disciplines,
  (SELECT COUNT(*) FROM experience_levels
     WHERE slug IN ('principiante', 'intermedio', 'avanzado', 'expedicion')) AS levels,
  (SELECT COUNT(*) FROM products) AS products;
