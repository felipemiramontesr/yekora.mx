-- 018 · V0.41.0 · FC 072 F0 · 2026-11-24 · Users, roles and permissions: editable roles and the seller.
--
-- Until now the roles of the staff were fixed by migrations and the console of administrators was
-- the owner's only door to the staff (FC 044). The panel «Usuarios, roles y permisos» (K-78, K-58)
-- lets the owner edit the roles and lets an administrator manage the sellers, and this migration
-- gives it the data it needs:
--   roles.is_system             1 for the roles the panel can never edit: owner and customer;
--   roles.assignable_by_admin   1 for the roles an administrator may give: the seller and the
--                               support roles; owner and admin stay at 0, whoever edits the panel;
--   staff_orders                is the Vendedor of the panel: only its visible name and description
--                               change, its id stays, so no row of user_roles moves and the grants
--                               of FC 068 and FC 071 (orders:manage, returns:view, returns:prepare)
--                               are kept; staff_catalog is a support role, renamed «Staff · Catálogo»;
--   permissions roles:manage    to create and edit roles and their matrix: the owner only;
--   permissions sellers:manage  to invite, assign and manage sellers: owner and admin.
--
-- The owner keeps being the union of every permission (008): the same INSERT … SELECT gives it the
-- two new ones. The admin gets sellers:manage and never roles:manage; users:manage was already its
-- own since 004. Existing users keep their roles and nothing is rewritten.
--
-- Idempotent (DB_LAW): ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS before each ADD
-- CONSTRAINT, INSERT IGNORE on the keys, and updates that set the same values on every run.

ALTER TABLE roles
  ADD COLUMN IF NOT EXISTS is_system TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assignable_by_admin TINYINT(1) NOT NULL DEFAULT 0,
  DROP CONSTRAINT IF EXISTS ck_roles_system,
  DROP CONSTRAINT IF EXISTS ck_roles_assignable,
  ADD CONSTRAINT ck_roles_system CHECK (is_system IN (0, 1)),
  ADD CONSTRAINT ck_roles_assignable CHECK (assignable_by_admin IN (0, 1));

UPDATE roles SET is_system = 1 WHERE id IN ('owner', 'customer');

UPDATE roles
  SET name = 'Vendedor',
      description = 'Atención en mostrador, venta en tienda y preparación de pedidos y devoluciones.',
      assignable_by_admin = 1
  WHERE id = 'staff_orders';

UPDATE roles SET name = 'Staff · Catálogo', assignable_by_admin = 1 WHERE id = 'staff_catalog';

INSERT IGNORE INTO permissions (id, module, description) VALUES
  ('roles:manage', 'roles', 'Crear y editar roles de apoyo y su matriz de permisos; exclusivo del Dueño.'),
  ('sellers:manage', 'users', 'Invitar, asignar rol y gestionar vendedores; permitido a administradores.');

-- The owner is the union of every permission, so it takes the two new ones with the same query as in 008.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
  SELECT 'owner', id FROM permissions;

INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES
  ('admin', 'sellers:manage');
