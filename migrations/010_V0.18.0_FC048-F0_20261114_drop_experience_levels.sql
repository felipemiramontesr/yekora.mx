-- 010 · V0.18.0 · FC 048 F0 · 2026-11-14 · «Nivel» never existed.
--
-- Ω (2026-11-12, 373_AN §7): the experience level is gone from every layer, as if it had never
-- existed. Its two homes in the database go: the table experience_levels with the reference
-- products.experience_level_id, and the system group «Nivel» of the product properties (006), with
-- the flag is_system that only that group needed. From now on every group of properties belongs to
-- the store: none is locked, and any can be retired.
--
-- Production was checked empty of products (Ω, 2026-11-14), so no assignment is lost. A backup
-- encrypted by db-migrations.yml precedes this anyway. Migrations 001 to 009 are never edited
-- (their SHA-256 sums are registered): only the read-only counters of 001 and 006 changed.
--
-- Idempotent (DB_LAW): DELETE of a code, DROP … IF EXISTS.

-- The values and links of the group go with it (ON DELETE CASCADE).
DELETE FROM product_facet_groups WHERE code = 'nivel';

-- The reference of the product, its index and its key.
ALTER TABLE products
  DROP FOREIGN KEY IF EXISTS fk_products_level,
  DROP INDEX IF EXISTS ix_products_level_active;

ALTER TABLE products
  DROP COLUMN IF EXISTS experience_level_id;

-- The lock of system groups: both checks name is_system, so they go before the column does.
ALTER TABLE product_facet_groups
  DROP CONSTRAINT IF EXISTS ck_product_facet_groups_system_active,
  DROP CONSTRAINT IF EXISTS ck_product_facet_groups_flags;

ALTER TABLE product_facet_groups
  DROP COLUMN IF EXISTS is_system,
  ADD CONSTRAINT ck_product_facet_groups_flags CHECK (
    is_required IN (0, 1) AND is_ordered IN (0, 1) AND is_filterable IN (0, 1)
    AND show_on_landing IN (0, 1) AND is_active IN (0, 1)
  );

DROP TABLE IF EXISTS experience_levels;
