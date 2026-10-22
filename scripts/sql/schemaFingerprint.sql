-- ============================================================
-- FC 015 F0 · Schema fingerprint (K-31, Archon's Rule 23 model). Single source: read by
-- scripts/dbParityCheck.ts locally and by db-migrations.yml in production (through the same
-- script), so both sides hash exactly the same projection.
--
-- Reads information_schema only: no user table, no data row, no personal data (T2). Prints one
-- line: the MD5 of every element sorted and joined by newlines, and the element count.
--
-- Elements (one row each, prefixed by kind):
--   T| table      name, type, engine, collation          (no ROW_FORMAT, no AUTO_INCREMENT)
--   C| column     table, name, position, type, nullable, default, extra, collation
--   V| view col   table, name, position                  (the engine derives type and default)
--   D| view def   table, MD5 of the definition without the schema prefix or backticks
--   I| index      table, name, position, column, non_unique, collation (A/D), prefix length
--   F| foreign    table, name, column, referenced table and column, ON DELETE, ON UPDATE
--   K| check      table, name, clause without backticks and with whitespace collapsed
--
-- Normalizations (MariaDB 10.4 local vs 11.x Hostinger): `utf8_*` ≡ `utf8mb3_*` (same charset,
-- renamed); CHECK clauses lose backticks and repeated whitespace. F4 measures both servers
-- before any further normalization is added.
--
-- The schema is the connected one (DATABASE()); `dbParityCheck.ts --sql <db>` swaps this line for
-- an explicit name to paste into phpMyAdmin.
-- ============================================================
SET SESSION group_concat_max_len = 100000000;
SET @db := DATABASE();
SELECT MD5(GROUP_CONCAT(x ORDER BY x SEPARATOR '\n')) AS fingerprint, COUNT(*) AS elements FROM (
  SELECT CONCAT('T|', table_name, '|', table_type, '|', IFNULL(engine, ''), '|',
                REPLACE(IFNULL(table_collation, ''), 'utf8_', 'utf8mb3_')) AS x
    FROM information_schema.tables
    WHERE table_schema = @db
  UNION ALL
  SELECT IF(v.table_name IS NULL,
            CONCAT('C|', c.table_name, '|', c.column_name, '|', c.ordinal_position, '|',
                   c.column_type, '|', c.is_nullable, '|', IFNULL(c.column_default, '<null>'), '|',
                   c.extra, '|', REPLACE(IFNULL(c.collation_name, ''), 'utf8_', 'utf8mb3_')),
            CONCAT('V|', c.table_name, '|', c.column_name, '|', c.ordinal_position))
    FROM information_schema.columns c
    LEFT JOIN information_schema.views v
      ON v.table_schema = c.table_schema AND v.table_name = c.table_name
    WHERE c.table_schema = @db
  UNION ALL
  SELECT CONCAT('D|', table_name, '|',
                MD5(REPLACE(REPLACE(view_definition, CONCAT('`', @db, '`.'), ''), '`', '')))
    FROM information_schema.views
    WHERE table_schema = @db
  UNION ALL
  SELECT CONCAT('I|', table_name, '|', index_name, '|', seq_in_index, '|', column_name, '|',
                non_unique, '|', IFNULL(collation, ''), '|', IFNULL(sub_part, ''))
    FROM information_schema.statistics
    WHERE table_schema = @db
  UNION ALL
  SELECT CONCAT('F|', k.table_name, '|', k.constraint_name, '|', k.column_name, '|',
                k.referenced_table_name, '|', k.referenced_column_name, '|',
                r.delete_rule, '|', r.update_rule)
    FROM information_schema.key_column_usage k
    JOIN information_schema.referential_constraints r
      ON r.constraint_schema = k.table_schema
     AND r.constraint_name = k.constraint_name
     AND r.table_name = k.table_name
    WHERE k.table_schema = @db
  UNION ALL
  SELECT CONCAT('K|', table_name, '|', constraint_name, '|',
                TRIM(REGEXP_REPLACE(REPLACE(check_clause, '`', ''), '[[:space:]]+', ' ')))
    FROM information_schema.check_constraints
    WHERE constraint_schema = @db
) elements;
