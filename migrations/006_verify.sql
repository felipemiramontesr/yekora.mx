-- FC 029 F0 · Verification counters of migration 006 (unified catalog, media, idempotency).
-- Aggregates only, never data rows or bytes; read-only. Run by scripts/migrateDb.ts after 006 is
-- applied or found registered. Not a migration (does not match MIGRATION_NAME).
-- Expected right after 006: the 7 new tables (7), product_images gone (0) and no media yet in
-- production. (The system group «Nivel» it created was removed by 010, FC 048: no counter left.)
SELECT
  (SELECT COUNT(*) FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('brands', 'product_facet_groups',
       'product_facet_values', 'product_facet_links', 'media_blobs', 'product_media',
       'idempotency_keys')) AS new_tables,
  (SELECT COUNT(*) FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_images') AS product_images_table,
  (SELECT COUNT(*) FROM media_blobs) AS media_blobs;
