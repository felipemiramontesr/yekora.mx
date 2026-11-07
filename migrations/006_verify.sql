-- FC 029 F0 · Verification counters of migration 006 (unified catalog, media, idempotency).
-- Aggregates only, never data rows or bytes; read-only. Run by scripts/migrateDb.ts after 006 is
-- applied or found registered. Not a migration (does not match MIGRATION_NAME).
-- Expected right after 006: the 7 new tables (7), product_images gone (0), the system group
-- "Nivel" (1) with one value per experience level (4), every product linked to its level
-- (unlinked_products = 0), and no media yet in production.
SELECT
  (SELECT COUNT(*) FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('brands', 'product_facet_groups',
       'product_facet_values', 'product_facet_links', 'media_blobs', 'product_media',
       'idempotency_keys')) AS new_tables,
  (SELECT COUNT(*) FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_images') AS product_images_table,
  (SELECT COUNT(*) FROM product_facet_groups WHERE code = 'nivel' AND is_system = 1) AS level_group,
  (SELECT COUNT(*) FROM product_facet_values v
     JOIN product_facet_groups g ON g.id = v.group_id WHERE g.code = 'nivel') AS level_values,
  (SELECT COUNT(*) FROM products p WHERE NOT EXISTS (
     SELECT 1 FROM product_facet_links k
     JOIN product_facet_values v ON v.id = k.value_id
     JOIN product_facet_groups g ON g.id = v.group_id AND g.code = 'nivel'
     JOIN experience_levels l ON l.slug = v.code
     WHERE k.product_id = p.id AND l.id = p.experience_level_id)) AS unlinked_products,
  (SELECT COUNT(*) FROM media_blobs) AS media_blobs;
