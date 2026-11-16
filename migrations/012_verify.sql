-- FC 052 F0 · Verification counters of migration 012 (Camping and Prepping).
-- Aggregates only, never data rows; read-only. Run by scripts/migrateDb.ts after 012 is applied
-- or found registered. Not a migration (does not match MIGRATION_NAME).
-- Expected right after 012: the two new disciplines (2) and the seven of the site in all (7).
SELECT
  (SELECT COUNT(*) FROM categories
     WHERE slug IN ('campismo', 'preparacionismo')) AS new_disciplines,
  (SELECT COUNT(*) FROM categories
     WHERE slug IN ('senderismo', 'montana', 'escalada', 'canonismo', 'trail-running',
                    'campismo', 'preparacionismo')) AS disciplines;
