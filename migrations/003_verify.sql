-- FC 015 F0 · Verification counters of migration 003 (orders and payments, FC 012).
-- Aggregates only, never data rows or personal data; read-only. Run by scripts/migrateDb.ts after
-- 003 is applied or found registered. Not a migration (does not match MIGRATION_NAME).
-- Expected after 003: order_statuses 6, processors 2, methods 4; orders, events and reserved
-- units are live counts (0 right after the migration).
SELECT
  (SELECT COUNT(*) FROM order_statuses WHERE id BETWEEN 1 AND 6) AS order_statuses,
  (SELECT COUNT(*) FROM payment_processors WHERE code IN ('STRIPE', 'MERCADO_PAGO')) AS processors,
  (SELECT COUNT(*) FROM payment_methods
     WHERE code IN ('CARD', 'OXXO', 'SPEI', 'MERCADO_PAGO_BALANCE')) AS methods,
  (SELECT COUNT(*) FROM orders) AS orders,
  (SELECT COUNT(*) FROM payment_events) AS payment_events,
  (SELECT IFNULL(SUM(reserved_stock), 0) FROM products) AS reserved_units;
