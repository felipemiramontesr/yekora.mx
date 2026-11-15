-- Rollback of 010 (FC 048 F0). Local use only: scripts/migrateDb.ts --down refuses any host but
-- localhost. Production never rolls back by deleting: it restores the encrypted backup taken
-- before the migration. It restores the structure and the four levels of 001, and the system group
-- «Nivel» of 006; every product is given the first level, since the assignment itself is gone.

CREATE TABLE IF NOT EXISTS experience_levels (
  id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(50) NOT NULL,
  name_es VARCHAR(100) NOT NULL,
  name_en VARCHAR(100) NOT NULL,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_experience_levels_slug (slug),
  CONSTRAINT ck_experience_levels_active CHECK (is_active IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO experience_levels (slug, name_es, name_en, sort_order) VALUES
  ('principiante', 'Principiante', 'Beginner', 1),
  ('intermedio', 'Intermedio', 'Intermediate', 2),
  ('avanzado', 'Avanzado', 'Advanced', 3),
  ('expedicion', 'Expedición', 'Expedition', 4);

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS experience_level_id SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER category_id;

ALTER TABLE products
  ADD KEY IF NOT EXISTS ix_products_level_active (experience_level_id, is_active),
  ADD CONSTRAINT fk_products_level FOREIGN KEY IF NOT EXISTS (experience_level_id)
    REFERENCES experience_levels (id) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE product_facet_groups
  DROP CONSTRAINT IF EXISTS ck_product_facet_groups_flags;

ALTER TABLE product_facet_groups
  ADD COLUMN IF NOT EXISTS is_system TINYINT(1) NOT NULL DEFAULT 0 AFTER show_on_landing,
  ADD CONSTRAINT ck_product_facet_groups_flags CHECK (
    is_required IN (0, 1) AND is_ordered IN (0, 1) AND is_filterable IN (0, 1)
    AND show_on_landing IN (0, 1) AND is_system IN (0, 1) AND is_active IN (0, 1)
  ),
  ADD CONSTRAINT ck_product_facet_groups_system_active CHECK (is_system = 0 OR is_active = 1);

INSERT IGNORE INTO product_facet_groups
  (code, name_es, name_en, is_required, is_ordered, is_filterable, show_on_landing, is_system, sort_order)
VALUES
  ('nivel', 'Nivel', 'Level', 1, 1, 1, 1, 1, 0);

INSERT IGNORE INTO product_facet_values (group_id, code, value_es, value_en, sort_order)
  SELECT g.id, l.slug, l.name_es, l.name_en, l.sort_order
  FROM experience_levels l
  JOIN product_facet_groups g ON g.code = 'nivel';
