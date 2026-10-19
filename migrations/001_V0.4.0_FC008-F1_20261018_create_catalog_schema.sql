-- 001 · V0.4.0 · FC 008 F1 · 2026-10-18 · Catalog schema (ADR 0003, ADR 0006, ADR 0007).
--
-- 3NF, InnoDB, utf8mb4_unicode_ci. No ENUM/SET (ADR 0007): every domain list is a reference
-- table with a stable slug, ES/EN names, sort order and an active flag, referenced by FK with
-- ON DELETE RESTRICT. Values are retired with is_active = 0, never deleted.
-- Idempotent (DB_LAW): CREATE TABLE IF NOT EXISTS and INSERT IGNORE by unique slug, so a second
-- run changes nothing. Seeds only the reference data; products start empty in production
-- (no invented offers: LFPC / A1). Development products live in seed_dev.sql.
-- The schema_migrations registry is created by scripts/migrateDb.ts before any migration runs.

CREATE TABLE IF NOT EXISTS categories (
  id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(40) NOT NULL,
  name_es VARCHAR(80) NOT NULL,
  name_en VARCHAR(80) NOT NULL,
  sort_order SMALLINT UNSIGNED NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_categories_slug (slug),
  CONSTRAINT ck_categories_active CHECK (is_active IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS experience_levels (
  id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(40) NOT NULL,
  name_es VARCHAR(80) NOT NULL,
  name_en VARCHAR(80) NOT NULL,
  sort_order SMALLINT UNSIGNED NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_experience_levels_slug (slug),
  CONSTRAINT ck_experience_levels_active CHECK (is_active IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Banxico SIE, series SF43718 (FIX): pesos per 1 USD, 4 decimals, one row per determination date.
CREATE TABLE IF NOT EXISTS exchange_rates (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  series_id VARCHAR(16) NOT NULL,
  determination_date DATE NOT NULL,
  rate_decimal DECIMAL(10, 4) NOT NULL,
  fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_exchange_rates_series_date (series_id, determination_date),
  CONSTRAINT ck_exchange_rates_positive CHECK (rate_decimal > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Price lives only in MXN cents; USD is computed from the FIX (no second source of truth).
CREATE TABLE IF NOT EXISTS products (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  sku VARCHAR(64) NOT NULL,
  slug VARCHAR(160) NOT NULL,
  category_id SMALLINT UNSIGNED NOT NULL,
  experience_level_id SMALLINT UNSIGNED NOT NULL,
  name_es VARCHAR(200) NOT NULL,
  name_en VARCHAR(200) NOT NULL,
  description_es TEXT NOT NULL,
  description_en TEXT NOT NULL,
  price_mxn_cents INT UNSIGNED NOT NULL,
  stock INT UNSIGNED NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_products_sku (sku),
  UNIQUE KEY uq_products_slug (slug),
  KEY ix_products_category_active (category_id, is_active),
  KEY ix_products_level_active (experience_level_id, is_active),
  CONSTRAINT fk_products_category FOREIGN KEY (category_id)
    REFERENCES categories (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_products_level FOREIGN KEY (experience_level_id)
    REFERENCES experience_levels (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_products_price_positive CHECK (price_mxn_cents > 0),
  CONSTRAINT ck_products_active CHECK (is_active IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Images are files of the static site (/images/products/*.webp); the table keeps order and alt text.
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

-- Reference data: the 5 disciplines of the site (app/i18n.ts) and the 4 levels Ω approved.
INSERT IGNORE INTO categories (slug, name_es, name_en, sort_order) VALUES
  ('senderismo', 'Senderismo', 'Hiking', 1),
  ('montana', 'Montaña', 'Mountaineering', 2),
  ('escalada', 'Escalada', 'Climbing', 3),
  ('canonismo', 'Cañonismo', 'Canyoning', 4),
  ('trail-running', 'Trail running', 'Trail running', 5);

INSERT IGNORE INTO experience_levels (slug, name_es, name_en, sort_order) VALUES
  ('principiante', 'Principiante', 'Beginner', 1),
  ('intermedio', 'Intermedio', 'Intermediate', 2),
  ('avanzado', 'Avanzado', 'Advanced', 3),
  ('expedicion', 'Expedición', 'Expedition', 4);
