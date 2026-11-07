-- Rollback of 006 (FC 029 F0). Local use only: scripts/migrateDb.ts --down refuses any host but
-- localhost. Production never rolls back by dropping: it restores the encrypted backup taken
-- before the migration.
--
-- product_images comes back exactly as migration 001 created it (empty, as it was).

CREATE TABLE IF NOT EXISTS product_images (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id INT UNSIGNED NOT NULL,
  path VARCHAR(255) NOT NULL,
  alt_es VARCHAR(200) NOT NULL,
  alt_en VARCHAR(200) NOT NULL,
  sort_order SMALLINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_product_images_order (product_id, sort_order),
  CONSTRAINT fk_product_images_product FOREIGN KEY (product_id)
    REFERENCES products (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_product_images_path CHECK (path LIKE '/images/products/%')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS fk_products_brand,
  DROP COLUMN IF EXISTS brand_id;

DROP TABLE IF EXISTS idempotency_keys;
DROP TABLE IF EXISTS product_media;
DROP TABLE IF EXISTS media_blobs;
DROP TABLE IF EXISTS product_facet_links;
DROP TABLE IF EXISTS product_facet_values;
DROP TABLE IF EXISTS product_facet_groups;
DROP TABLE IF EXISTS brands;
