-- 006 · V0.12.0 · FC 029 F0 · 2026-11-04 · Unified catalog, media in MariaDB and idempotency keys.
--
-- Brands and faceted classification (T2.1a, T2.1c): every key toward the catalog is INT UNSIGNED,
-- like products.id (migration 001). A facet link needs an existing product and an existing value;
-- deleting either deletes the link (CASCADE). Nothing here is ever deleted by the API: retiring
-- is is_active = 0 (T2.3c), so the cascades only serve local rollbacks.
--
-- System group "Nivel" (T2.1b, T2.6): its values mirror experience_levels one to one (same slug as
-- code), and every existing product gets the link of its experience_level_id. From F2 on, every
-- product mutation keeps both in step.
--
-- Media (ADR 0012, T2.2a): the bytes live once in media_blobs, keyed by their SHA-256, which the
-- API computes itself; product_media places a blob in a product's gallery. A blob in use cannot
-- be dropped (RESTRICT). product_images (paths to static files) was never filled and goes (T0.2).
--
-- Idempotency (ADR 0014): one row per Idempotency-Key (stored as its SHA-256), with the request
-- hash and the stored answer, for the user who sent it.
--
-- Business times use DATETIME in UTC, written by the API (same rule as 003, 004 and 005).
--
-- Idempotent (DB_LAW): CREATE TABLE IF NOT EXISTS, ADD COLUMN / CONSTRAINT IF NOT EXISTS,
-- INSERT IGNORE by unique code, DROP TABLE IF EXISTS.

CREATE TABLE IF NOT EXISTS brands (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(100) NOT NULL,
  name VARCHAR(150) NOT NULL,
  website VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_brands_slug (slug),
  CONSTRAINT ck_brands_active CHECK (is_active IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_facet_groups (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(50) NOT NULL,
  name_es VARCHAR(100) NOT NULL,
  name_en VARCHAR(100) NOT NULL,
  is_required TINYINT(1) NOT NULL DEFAULT 0,
  is_ordered TINYINT(1) NOT NULL DEFAULT 0,
  is_filterable TINYINT(1) NOT NULL DEFAULT 1,
  show_on_landing TINYINT(1) NOT NULL DEFAULT 0,
  is_system TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_product_facet_groups_code (code),
  CONSTRAINT ck_product_facet_groups_flags CHECK (
    is_required IN (0, 1) AND is_ordered IN (0, 1) AND is_filterable IN (0, 1)
    AND show_on_landing IN (0, 1) AND is_system IN (0, 1) AND is_active IN (0, 1)
  ),
  -- T2.1b: a system group is never retired, not even by hand in the database.
  CONSTRAINT ck_product_facet_groups_system_active CHECK (is_system = 0 OR is_active = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_facet_values (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  group_id INT UNSIGNED NOT NULL,
  code VARCHAR(50) NOT NULL,
  value_es VARCHAR(100) NOT NULL,
  value_en VARCHAR(100) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_product_facet_values_code (group_id, code),
  CONSTRAINT fk_facet_val_group FOREIGN KEY (group_id)
    REFERENCES product_facet_groups (id) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_facet_links (
  product_id INT UNSIGNED NOT NULL,
  value_id INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (product_id, value_id),
  KEY ix_product_facet_links_value (value_id),
  CONSTRAINT fk_facet_link_prod FOREIGN KEY (product_id)
    REFERENCES products (id) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_facet_link_val FOREIGN KEY (value_id)
    REFERENCES product_facet_values (id) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS media_blobs (
  sha256 CHAR(64) NOT NULL,
  mime_type VARCHAR(50) NOT NULL,
  width INT UNSIGNED NOT NULL,
  height INT UNSIGNED NOT NULL,
  size_bytes INT UNSIGNED NOT NULL,
  media_data MEDIUMBLOB NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (sha256),
  CONSTRAINT ck_media_blobs_sha256 CHECK (sha256 REGEXP '^[0-9a-f]{64}$'),
  -- T2.2b: no SVG, only the three raster types the API accepts.
  CONSTRAINT ck_media_blobs_mime CHECK (mime_type IN ('image/webp', 'image/jpeg', 'image/png')),
  -- T1.2 S: 2 MB (2 097 152 bytes) at most, and the stored size is the real one.
  CONSTRAINT ck_media_blobs_size CHECK (
    size_bytes BETWEEN 1 AND 2097152 AND size_bytes = OCTET_LENGTH(media_data)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_media (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id INT UNSIGNED NOT NULL,
  media_sha256 CHAR(64) NOT NULL,
  alt_text_es VARCHAR(255) NULL,
  alt_text_en VARCHAR(255) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_media_prod_sort (product_id, sort_order),
  KEY ix_product_media_blob (media_sha256),
  CONSTRAINT fk_media_prod FOREIGN KEY (product_id)
    REFERENCES products (id) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_media_blob FOREIGN KEY (media_sha256)
    REFERENCES media_blobs (sha256) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_product_media_flags CHECK (is_primary IN (0, 1) AND is_active IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key_hash CHAR(64) NOT NULL,
  user_id CHAR(36) NOT NULL,
  route VARCHAR(255) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  response_status INT NOT NULL,
  response_headers JSON NOT NULL,
  response_body MEDIUMTEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (key_hash),
  KEY idx_idemp_expires (expires_at),
  KEY ix_idempotency_keys_user (user_id),
  CONSTRAINT fk_idemp_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT ck_idempotency_keys_hashes CHECK (
    CHAR_LENGTH(key_hash) = 64 AND CHAR_LENGTH(request_hash) = 64
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS brand_id INT UNSIGNED NULL AFTER category_id,
  ADD CONSTRAINT fk_products_brand FOREIGN KEY IF NOT EXISTS (brand_id)
    REFERENCES brands (id) ON DELETE SET NULL ON UPDATE RESTRICT;

-- System group "Nivel" and its values, one per experience level (T2.1b, T2.6).
INSERT IGNORE INTO product_facet_groups
  (code, name_es, name_en, is_required, is_ordered, is_filterable, show_on_landing, is_system, sort_order)
VALUES
  ('nivel', 'Nivel', 'Level', 1, 1, 1, 1, 1, 0);

INSERT IGNORE INTO product_facet_values (group_id, code, value_es, value_en, sort_order)
  SELECT g.id, l.slug, l.name_es, l.name_en, l.sort_order
  FROM experience_levels l
  JOIN product_facet_groups g ON g.code = 'nivel';

-- Every existing product gets the "Nivel" value of its experience level.
INSERT IGNORE INTO product_facet_links (product_id, value_id)
  SELECT p.id, v.id
  FROM products p
  JOIN experience_levels l ON l.id = p.experience_level_id
  JOIN product_facet_groups g ON g.code = 'nivel'
  JOIN product_facet_values v ON v.group_id = g.id AND v.code = l.slug;

-- T0.2, T2.1d: product_images held paths to static files and was never filled; images now live in
-- media_blobs. Production was checked empty (299_AN) and is backed up before this runs.
DROP TABLE IF EXISTS product_images;
