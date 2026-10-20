-- DEVELOPMENT AND TEST DATA ONLY (FC 008 F1). Never applied in production: scripts/migrateDb.ts
-- --seed-dev refuses any host but localhost. These products are fictitious placeholders for
-- building and testing the catalog; real products are loaded by an Admin account (K-07).
-- Idempotent: INSERT IGNORE by unique sku / (product_id, sort_order).
-- FC 011: every product carries weight (g), dimensions (mm) and a shipping class; migration 002
-- makes them mandatory, so these fictitious ones include plausible boxed values.

INSERT IGNORE INTO products
  (sku, slug, category_id, experience_level_id, name_es, name_en, description_es, description_en, price_mxn_cents, stock,
   weight_grams, length_mm, width_mm, height_mm, shipping_class_id)
SELECT 'DEV-0001', 'dev-mochila-ligera-28l', c.id, l.id,
  'Mochila ligera 28 L (prueba)', 'Light backpack 28 L (test)',
  'Producto ficticio para desarrollo local.', 'Fictitious product for local development.',
  185000, 12, 1200, 500, 300, 200, k.id
FROM categories c JOIN experience_levels l ON l.slug = 'principiante'
  JOIN shipping_classes k ON k.slug = 'estandar'
WHERE c.slug = 'senderismo';

INSERT IGNORE INTO products
  (sku, slug, category_id, experience_level_id, name_es, name_en, description_es, description_en, price_mxn_cents, stock,
   weight_grams, length_mm, width_mm, height_mm, shipping_class_id)
SELECT 'DEV-0002', 'dev-arnes-alpino', c.id, l.id,
  'Arnés alpino (prueba)', 'Alpine harness (test)',
  'Producto ficticio para desarrollo local.', 'Fictitious product for local development.',
  485000, 4, 450, 300, 250, 100, k.id
FROM categories c JOIN experience_levels l ON l.slug = 'avanzado'
  JOIN shipping_classes k ON k.slug = 'estandar'
WHERE c.slug = 'escalada';

INSERT IGNORE INTO products
  (sku, slug, category_id, experience_level_id, name_es, name_en, description_es, description_en, price_mxn_cents, stock,
   weight_grams, length_mm, width_mm, height_mm, shipping_class_id)
SELECT 'DEV-0003', 'dev-tenis-trail', c.id, l.id,
  'Tenis de trail (prueba)', 'Trail shoes (test)',
  'Producto ficticio para desarrollo local.', 'Fictitious product for local development.',
  259900, 0, 900, 330, 220, 130, k.id
FROM categories c JOIN experience_levels l ON l.slug = 'intermedio'
  JOIN shipping_classes k ON k.slug = 'estandar'
WHERE c.slug = 'trail-running';

INSERT IGNORE INTO product_images (product_id, path, alt_es, alt_en, sort_order)
SELECT p.id, '/images/products/dev-arnes-alpino-1.webp', 'Arnés alpino de prueba', 'Test alpine harness', 1
FROM products p WHERE p.sku = 'DEV-0002';

-- Canonical FIX row of the FC (485000 MXN cents / 18.5000 = 26216 USD cents).
INSERT IGNORE INTO exchange_rates (series_id, determination_date, rate_decimal)
VALUES ('SF43718', '2026-10-16', 18.5000);
