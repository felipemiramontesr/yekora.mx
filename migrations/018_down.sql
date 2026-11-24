-- Rollback of 018 (FC 072 F0). Local use only: scripts/migrateDb.ts --down refuses any host but
-- localhost. Production never rolls back by deleting: it restores the encrypted backup taken
-- before the migration. The two permissions and their grants go, the names of the two staff roles
-- return to what 004 gave them, and the two columns leave roles with their checks.

DELETE FROM role_permissions WHERE permission_id IN ('roles:manage', 'sellers:manage');
DELETE FROM permissions WHERE id IN ('roles:manage', 'sellers:manage');

UPDATE roles
  SET name = 'Staff · pedidos y envíos', description = 'Consulta y opera pedidos.'
  WHERE id = 'staff_orders';
UPDATE roles SET name = 'Staff · catálogo' WHERE id = 'staff_catalog';

ALTER TABLE roles
  DROP CONSTRAINT IF EXISTS ck_roles_system,
  DROP CONSTRAINT IF EXISTS ck_roles_assignable,
  DROP COLUMN IF EXISTS is_system,
  DROP COLUMN IF EXISTS assignable_by_admin;
