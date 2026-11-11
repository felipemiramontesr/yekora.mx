-- 008 · V0.14.0 · FC 044 F0 · 2026-11-11 · The owner role.
--
-- `owner` is the account of the store's proprietor (T0.1, T2.1): it holds every permission and
-- is the only role that grants and withdraws `admin`. No HTTP route grants it; one account
-- receives it out of band, from the server (scripts/provisionOwner.ts).
--
-- Like `admin` in 004, it gets the union of the catalog with one INSERT … SELECT, never a
-- hand-kept list. A migration that adds a permission later must repeat that statement for both
-- roles; apps/api/src/db.integration.test.ts fails when either misses one.
--
-- Idempotent (DB_LAW): INSERT IGNORE.

INSERT IGNORE INTO roles (id, name, description) VALUES
  ('owner', 'Dueño', 'Cuenta omnipotente del propietario; único que concede y retira administradores y posee todos los permisos.');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
  SELECT 'owner', id FROM permissions;
