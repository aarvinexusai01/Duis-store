-- The owner's size charts (2026-10-23), transcribed in inches from the Duis
-- size-chart artwork; the size guide converts to centimetres (× 2.54, which
-- reproduces the artwork's cm tables). Safe on any database: charts are added
-- once by name, and linked only to categories that exist and have no chart of
-- their own, so a staff choice is never overwritten.
INSERT INTO size_charts (name, unit, chart, how_to_measure)
SELECT v.name, 'in', v.chart::jsonb, v.how_to_measure
FROM (VALUES
  ('Oversized Hoodie',
   '{"columns": ["Chest", "Front Length", "Sleeve Length"], "rows": [
      {"size": "S",   "values": ["44", "28",   "23.625"]},
      {"size": "M",   "values": ["46", "28.5", "24"]},
      {"size": "L",   "values": ["48", "29",   "24.375"]},
      {"size": "XL",  "values": ["50", "29.5", "24.75"]},
      {"size": "2XL", "values": ["52", "30",   "25.125"]},
      {"size": "3XL", "values": ["54", "30.5", "25.5"]}]}',
   E'Oversized fit: super loose on the body for a relaxed streetwear look. Premium cotton blend fleece.\nChest: measure around the fullest part of your chest, keeping the tape horizontal.\nFront length: measure from the highest point of the shoulder to the bottom hem.\nSleeve length: measure from the shoulder seam to the end of the sleeve.'),
  ('Oversized Sweatshirt',
   '{"columns": ["Chest", "Front Length", "Sleeve Length"], "rows": [
      {"size": "S",   "values": ["44", "28",   "23.75"]},
      {"size": "M",   "values": ["46", "28.5", "24"]},
      {"size": "L",   "values": ["48", "29",   "24.25"]},
      {"size": "XL",  "values": ["50", "29.5", "24.5"]},
      {"size": "2XL", "values": ["52", "30",   "24.75"]},
      {"size": "3XL", "values": ["54", "30.5", "25"]}]}',
   E'Oversized fit: super loose on the body for a relaxed streetwear look. Premium cotton blend.\nChest: measure around the fullest part of your chest, keeping the tape horizontal.\nFront length: measure from the highest point of the shoulder to the bottom hem.\nSleeve length: measure from the shoulder seam to the end of the sleeve.'),
  ('Oversized T-Shirt',
   '{"columns": ["Chest", "Front Length", "Sleeve Length"], "rows": [
      {"size": "S",   "values": ["42", "29",    "9.75"]},
      {"size": "M",   "values": ["44", "29.75", "10"]},
      {"size": "L",   "values": ["46", "30.5",  "10.25"]},
      {"size": "XL",  "values": ["48", "31.25", "10.5"]},
      {"size": "2XL", "values": ["50", "32",    "10.75"]},
      {"size": "3XL", "values": ["52", "32.75", "11"]}]}',
   E'Oversized fit: super loose on the body for a relaxed streetwear look. Premium cotton blend.\nChest: measure around the fullest part of your chest, keeping the tape horizontal.\nFront length: measure from the highest point of the shoulder to the bottom hem.\nSleeve length: measure from the shoulder seam to the end of the sleeve.'),
  ('Regular Fit T-Shirt',
   '{"columns": ["Chest", "Front Length", "Sleeve Length"], "rows": [
      {"size": "S",   "values": ["38", "27.25", "8"]},
      {"size": "M",   "values": ["40", "28",    "8.25"]},
      {"size": "L",   "values": ["42", "28.75", "8.5"]},
      {"size": "XL",  "values": ["44", "29.5",  "8.75"]},
      {"size": "2XL", "values": ["46", "30",    "9"]},
      {"size": "3XL", "values": ["48", "30.5",  "9.25"]}]}',
   E'Regular fit: comfortable at the chest with a straight cut down to the waist. Premium cotton blend.\nChest: measure around the fullest part of your chest, keeping the tape horizontal.\nFront length: measure from the highest point of the shoulder to the bottom hem.\nSleeve length: measure from the shoulder seam to the end of the sleeve.')
) AS v(name, chart, how_to_measure)
WHERE NOT EXISTS (SELECT 1 FROM size_charts s WHERE s.name = v.name);
--> statement-breakpoint
UPDATE categories c SET size_chart_id = s.id, updated_at = now()
FROM size_charts s, (VALUES
  ('hoodies', 'Oversized Hoodie'),
  ('sweatshirts', 'Oversized Sweatshirt'),
  ('oversized-t-shirts', 'Oversized T-Shirt'),
  ('graphic-t-shirts', 'Oversized T-Shirt'),
  ('regular-fit-t-shirts', 'Regular Fit T-Shirt'),
  ('polo-t-shirts', 'Regular Fit T-Shirt')
) AS m(category_slug, chart_name)
WHERE c.slug = m.category_slug AND s.name = m.chart_name AND c.size_chart_id IS NULL;
--> statement-breakpoint
-- "2XL" is the size customers see (owner decision 2026-10-23). The value's
-- slug stays "xxl", so filter links and variant signatures don't change;
-- past order lines keep the label they were bought under.
UPDATE attribute_values SET label = '2XL', updated_at = now()
WHERE label = 'XXL' AND attribute_id IN (SELECT id FROM attributes WHERE code = 'size');
--> statement-breakpoint
UPDATE size_charts
SET chart = replace(chart::text, '"size": "XXL"', '"size": "2XL"')::jsonb, updated_at = now()
WHERE chart::text LIKE '%"size": "XXL"%';
