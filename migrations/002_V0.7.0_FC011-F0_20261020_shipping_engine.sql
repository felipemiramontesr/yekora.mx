-- 002 · V0.7.0 · FC 011 F0 · 2026-10-20 · Shipping engine schema (ADR 0003, ADR 0007, ADR 0010).
--
-- Products carry physical data only (weight, dimensions, shipping class), never a shipping price
-- (Ω, 092_AN §1). Rates live in shipping_rules and the Admin's choice in shipping_configs.
--
-- No rates and no configuration are seeded (Ω, 2026-10-20, option A): inventing a tariff is
-- forbidden, so until Ω or the client loads real ones every destination quotes as not
-- serviceable. Only the reference catalogs are seeded: shipping classes, the 32 Mexican states
-- (ISO 3166-2:MX codes) and the five strategies the engine knows.
--
-- Physical data is mandatory and positive. Products start empty in production; development
-- products get theirs in seed_dev.sql. If a table ever holds a product without that data, the
-- single ALTER below fails as a whole (InnoDB ALTER is atomic), so nothing is left half-applied.
--
-- Idempotent (DB_LAW): CREATE TABLE IF NOT EXISTS, INSERT IGNORE by unique code, and
-- ADD COLUMN / ADD CONSTRAINT IF NOT EXISTS, so a second run changes nothing.

-- Logistic handling classes. The order's class is the present class with the highest
-- class_rank, never chosen by name. (class_rank, not rank: RANK is reserved in MySQL 8.)
CREATE TABLE IF NOT EXISTS shipping_classes (
  id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(40) NOT NULL,
  name_es VARCHAR(80) NOT NULL,
  name_en VARCHAR(80) NOT NULL,
  class_rank SMALLINT UNSIGNED NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_shipping_classes_slug (slug),
  UNIQUE KEY uq_shipping_classes_rank (class_rank),
  CONSTRAINT ck_shipping_classes_rank CHECK (class_rank > 0),
  CONSTRAINT ck_shipping_classes_active CHECK (is_active IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Destinations: the 32 federal entities, by their ISO 3166-2:MX code without the MX- prefix.
-- Postal-code ranges can refine a zone later without changing this table (ADR 0010).
-- The code is ASCII with a binary collation: under the table's case-insensitive collation the
-- REGEXP check would accept 'zac', and the API matches codes exactly.
CREATE TABLE IF NOT EXISTS shipping_zones (
  id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name_es VARCHAR(80) NOT NULL,
  name_en VARCHAR(80) NOT NULL,
  sort_order SMALLINT UNSIGNED NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_shipping_zones_code (code),
  CONSTRAINT ck_shipping_zones_code CHECK (code REGEXP '^[A-Z]{3}$'),
  CONSTRAINT ck_shipping_zones_active CHECK (is_active IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Pricing strategies the engine evaluates. Ids are fixed: the rule constraints below and the
-- engine refer to them, and a strategy is retired with is_active = 0, never renumbered.
CREATE TABLE IF NOT EXISTS shipping_strategies (
  id SMALLINT UNSIGNED NOT NULL,
  code VARCHAR(32) NOT NULL,
  name_es VARCHAR(80) NOT NULL,
  name_en VARCHAR(80) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_shipping_strategies_code (code),
  CONSTRAINT ck_shipping_strategies_active CHECK (is_active IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The Admin's choice: at most one row (id = 1). No row means "not configured": nothing is
-- serviceable. Free shipping is a modifier over the active strategy; when it is on, its
-- threshold (cart items total with VAT, 073_AN) is mandatory and positive.
CREATE TABLE IF NOT EXISTS shipping_configs (
  id TINYINT UNSIGNED NOT NULL,
  active_strategy_id SMALLINT UNSIGNED NOT NULL,
  is_free_shipping_active TINYINT(1) NOT NULL,
  free_shipping_threshold_mxn_cents INT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_shipping_configs_strategy FOREIGN KEY (active_strategy_id)
    REFERENCES shipping_strategies (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_shipping_configs_single_row CHECK (id = 1),
  CONSTRAINT ck_shipping_configs_free_flag CHECK (is_free_shipping_active IN (0, 1)),
  CONSTRAINT ck_shipping_configs_free_threshold CHECK (
    is_free_shipping_active = 0
    OR (free_shipping_threshold_mxn_cents IS NOT NULL AND free_shipping_threshold_mxn_cents > 0)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rates, in MXN cents with VAT included (073_AN), charged once per purchase. Which columns a
-- rule uses depends on its strategy:
--   1 FLAT_RATE          no zone, no class, no range (one national rate)
--   2 ZONE_RATE          zone required
--   3 ZONE_CLASS_RATE    zone and class required
--   4 CHARGEABLE_WEIGHT  weight range [min, max) in grams; max NULL = no upper bound
--   5 ORDER_TOTAL        items-total range [min, max) in cents with VAT; max NULL = no bound
-- Overlaps are allowed; the engine breaks ties by lowest rate, then lowest id (FC 011).
CREATE TABLE IF NOT EXISTS shipping_rules (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  strategy_id SMALLINT UNSIGNED NOT NULL,
  zone_id SMALLINT UNSIGNED NULL,
  shipping_class_id SMALLINT UNSIGNED NULL,
  min_weight_grams INT UNSIGNED NULL,
  max_weight_grams INT UNSIGNED NULL,
  min_items_total_mxn_cents INT UNSIGNED NULL,
  max_items_total_mxn_cents INT UNSIGNED NULL,
  rate_mxn_cents INT UNSIGNED NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_shipping_rules_strategy_active (strategy_id, is_active, zone_id),
  CONSTRAINT fk_shipping_rules_strategy FOREIGN KEY (strategy_id)
    REFERENCES shipping_strategies (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_shipping_rules_zone FOREIGN KEY (zone_id)
    REFERENCES shipping_zones (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_shipping_rules_class FOREIGN KEY (shipping_class_id)
    REFERENCES shipping_classes (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_shipping_rules_active CHECK (is_active IN (0, 1)),
  CONSTRAINT ck_shipping_rules_shape CHECK (
    (strategy_id = 1 AND zone_id IS NULL AND shipping_class_id IS NULL
      AND min_weight_grams IS NULL AND max_weight_grams IS NULL
      AND min_items_total_mxn_cents IS NULL AND max_items_total_mxn_cents IS NULL)
    OR (strategy_id = 2 AND zone_id IS NOT NULL AND shipping_class_id IS NULL
      AND min_weight_grams IS NULL AND max_weight_grams IS NULL
      AND min_items_total_mxn_cents IS NULL AND max_items_total_mxn_cents IS NULL)
    OR (strategy_id = 3 AND zone_id IS NOT NULL AND shipping_class_id IS NOT NULL
      AND min_weight_grams IS NULL AND max_weight_grams IS NULL
      AND min_items_total_mxn_cents IS NULL AND max_items_total_mxn_cents IS NULL)
    OR (strategy_id = 4 AND zone_id IS NULL AND shipping_class_id IS NULL
      AND min_weight_grams IS NOT NULL
      AND (max_weight_grams IS NULL OR max_weight_grams > min_weight_grams)
      AND min_items_total_mxn_cents IS NULL AND max_items_total_mxn_cents IS NULL)
    OR (strategy_id = 5 AND zone_id IS NULL AND shipping_class_id IS NULL
      AND min_weight_grams IS NULL AND max_weight_grams IS NULL
      AND min_items_total_mxn_cents IS NOT NULL
      AND (max_items_total_mxn_cents IS NULL OR max_items_total_mxn_cents > min_items_total_mxn_cents))
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Reference data. Ranks leave gaps so a class can be inserted between two later.
INSERT IGNORE INTO shipping_classes (slug, name_es, name_en, class_rank) VALUES
  ('estandar', 'Estándar', 'Standard', 10),
  ('voluminoso', 'Voluminoso o pesado', 'Bulky or heavy', 20);

INSERT IGNORE INTO shipping_strategies (id, code, name_es, name_en) VALUES
  (1, 'FLAT_RATE', 'Tarifa fija por compra', 'Flat rate per purchase'),
  (2, 'ZONE_RATE', 'Tarifa por estado', 'Rate by state'),
  (3, 'ZONE_CLASS_RATE', 'Tarifa por estado y clase', 'Rate by state and class'),
  (4, 'CHARGEABLE_WEIGHT', 'Tarifa por peso cobrable', 'Rate by chargeable weight'),
  (5, 'ORDER_TOTAL', 'Tarifa por monto de compra', 'Rate by purchase amount');

INSERT IGNORE INTO shipping_zones (code, name_es, name_en, sort_order) VALUES
  ('AGU', 'Aguascalientes', 'Aguascalientes', 1),
  ('BCN', 'Baja California', 'Baja California', 2),
  ('BCS', 'Baja California Sur', 'Baja California Sur', 3),
  ('CAM', 'Campeche', 'Campeche', 4),
  ('CHP', 'Chiapas', 'Chiapas', 5),
  ('CHH', 'Chihuahua', 'Chihuahua', 6),
  ('CMX', 'Ciudad de México', 'Mexico City', 7),
  ('COA', 'Coahuila', 'Coahuila', 8),
  ('COL', 'Colima', 'Colima', 9),
  ('DUR', 'Durango', 'Durango', 10),
  ('MEX', 'Estado de México', 'State of Mexico', 11),
  ('GUA', 'Guanajuato', 'Guanajuato', 12),
  ('GRO', 'Guerrero', 'Guerrero', 13),
  ('HID', 'Hidalgo', 'Hidalgo', 14),
  ('JAL', 'Jalisco', 'Jalisco', 15),
  ('MIC', 'Michoacán', 'Michoacán', 16),
  ('MOR', 'Morelos', 'Morelos', 17),
  ('NAY', 'Nayarit', 'Nayarit', 18),
  ('NLE', 'Nuevo León', 'Nuevo León', 19),
  ('OAX', 'Oaxaca', 'Oaxaca', 20),
  ('PUE', 'Puebla', 'Puebla', 21),
  ('QUE', 'Querétaro', 'Querétaro', 22),
  ('ROO', 'Quintana Roo', 'Quintana Roo', 23),
  ('SLP', 'San Luis Potosí', 'San Luis Potosí', 24),
  ('SIN', 'Sinaloa', 'Sinaloa', 25),
  ('SON', 'Sonora', 'Sonora', 26),
  ('TAB', 'Tabasco', 'Tabasco', 27),
  ('TAM', 'Tamaulipas', 'Tamaulipas', 28),
  ('TLA', 'Tlaxcala', 'Tlaxcala', 29),
  ('VER', 'Veracruz', 'Veracruz', 30),
  ('YUC', 'Yucatán', 'Yucatán', 31),
  ('ZAC', 'Zacatecas', 'Zacatecas', 32);

-- Physical data of every product: one atomic ALTER (see header).
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS weight_grams INT UNSIGNED NOT NULL,
  ADD COLUMN IF NOT EXISTS length_mm INT UNSIGNED NOT NULL,
  ADD COLUMN IF NOT EXISTS width_mm INT UNSIGNED NOT NULL,
  ADD COLUMN IF NOT EXISTS height_mm INT UNSIGNED NOT NULL,
  ADD COLUMN IF NOT EXISTS shipping_class_id SMALLINT UNSIGNED NOT NULL,
  ADD CONSTRAINT IF NOT EXISTS ck_products_physical_positive CHECK (
    weight_grams > 0 AND length_mm > 0 AND width_mm > 0 AND height_mm > 0
  ),
  ADD CONSTRAINT fk_products_shipping_class FOREIGN KEY IF NOT EXISTS (shipping_class_id)
    REFERENCES shipping_classes (id) ON DELETE RESTRICT ON UPDATE RESTRICT;
