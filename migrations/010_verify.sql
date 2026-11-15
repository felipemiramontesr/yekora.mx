-- FC 048 F0 · Verification counters of migration 010 («Nivel» never existed).
-- Aggregates only, never data rows; read-only. Run by scripts/migrateDb.ts after 010 is applied
-- or found registered. Not a migration (does not match MIGRATION_NAME).
-- Expected right after 010: no level table (0), no reference to it in products (0), no flag
-- is_system in the groups (0), no group «Nivel» (0) and no link left pointing at a missing value (0).
SELECT
  (SELECT COUNT(*) FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'experience_levels') AS level_table,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products'
       AND COLUMN_NAME = 'experience_level_id') AS level_column,
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_facet_groups'
       AND COLUMN_NAME = 'is_system') AS system_flag,
  (SELECT COUNT(*) FROM product_facet_groups WHERE code = 'nivel') AS level_group,
  (SELECT COUNT(*) FROM product_facet_links k
     LEFT JOIN product_facet_values v ON v.id = k.value_id WHERE v.id IS NULL) AS orphan_links;
