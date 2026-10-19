-- DEVELOPMENT AND TEST DATA ONLY (FC 008 F1). Never applied in production: scripts/migrateDb.ts
-- --seed-dev refuses any host but localhost. These products are fictitious placeholders for
-- building and testing the catalog; real products are loaded by an Admin account (K-07).
-- Idempotent: INSERT IGNORE by unique sku / (product_id, sort_order).

INSERT IGNORE INTO products
  (sku, slug, category_id, experience_level_id, name_es, name_en, description_es, description_en, price_mxn_cents, stock)
SELECT 'DEV-0001', 'dev-mochila-ligera-28l', c.id, l.id,
  'Mochila ligera 28 L (prueba)', 'Light backpack 28 L (test)',
  'Producto ficticio para desarrollo local.', 'Fictitious product for local development.',
  185000, 12
FROM categories c JOIN experience_levels l ON l.slug = 'principiante' WHERE c.slug = 'senderismo';

INSERT IGNORE INTO products
  (sku, slug, category_id, experience_level_id, name_es, name_en, description_es, description_en, price_mxn_cents, stock)
SELECT 'DEV-0002', 'dev-arnes-alpino', c.id, l.id,
  'Arnés alpino (prueba)', 'Alpine harness (test)',
  'Producto ficticio para desarrollo local.', 'Fictitious product for local development.',
  485000, 4
FROM categories c JOIN experience_levels l ON l.slug = 'avanzado' WHERE c.slug = 'escalada';

INSERT IGNORE INTO products
  (sku, slug, category_id, experience_level_id, name_es, name_en, description_es, description_en, price_mxn_cents, stock)
SELECT 'DEV-0003', 'dev-tenis-trail', c.id, l.id,
  'Tenis de trail (prueba)', 'Trail shoes (test)',
  'Producto ficticio para desarrollo local.', 'Fictitious product for local development.',
  259900, 0
FROM categories c JOIN experience_levels l ON l.slug = 'intermedio' WHERE c.slug = 'trail-running';

INSERT IGNORE INTO product_images (product_id, path, alt_es, alt_en, sort_order)
SELECT p.id, '/images/products/dev-arnes-alpino-1.webp', 'Arnés alpino de prueba', 'Test alpine harness', 1
FROM products p WHERE p.sku = 'DEV-0002';

-- Canonical FIX row of the FC (485000 MXN cents / 18.5000 = 26216 USD cents).
INSERT IGNORE INTO exchange_rates (series_id, determination_date, rate_decimal)
VALUES ('SF43718', '2026-10-16', 18.5000);
