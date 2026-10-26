CREATE TABLE "search_index_queue" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Search documents follow the database (ADR-0033): anything that changes a
-- product's searchable text, filters, price, stock or card queues it here,
-- whatever code (or person) made the change, and wakes the worker's indexer.
-- clock_timestamp() so a re-queue during indexing is never mistaken for the
-- row the indexer read.
CREATE FUNCTION queue_search_index(ids uuid[]) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO search_index_queue (product_id)
  SELECT DISTINCT id FROM unnest(ids) AS id WHERE id IS NOT NULL
  ON CONFLICT (product_id) DO UPDATE SET queued_at = clock_timestamp();
  PERFORM pg_notify('duis_search', '');
END
$$;
--> statement-breakpoint
CREATE FUNCTION queue_search_index_row() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  column_name text := TG_ARGV[0];
  ids uuid[] := '{}';
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    ids := ids || (to_jsonb(OLD) ->> column_name)::uuid;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    ids := ids || (to_jsonb(NEW) ->> column_name)::uuid;
  END IF;
  PERFORM queue_search_index(ids);
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER products_queue_search
AFTER INSERT OR UPDATE OR DELETE ON products
FOR EACH ROW EXECUTE FUNCTION queue_search_index_row('id');
--> statement-breakpoint
CREATE TRIGGER product_listing_cache_queue_search
AFTER INSERT OR UPDATE OR DELETE ON product_listing_cache
FOR EACH ROW EXECUTE FUNCTION queue_search_index_row('product_id');
--> statement-breakpoint
CREATE TRIGGER product_variants_queue_search
AFTER INSERT OR DELETE OR UPDATE OF price_paise, mrp_paise, status ON product_variants
FOR EACH ROW EXECUTE FUNCTION queue_search_index_row('product_id');
--> statement-breakpoint
-- A renamed colour or fit label shows in the cards and filters of every
-- product that has it.
CREATE FUNCTION queue_search_index_value() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM queue_search_index(array(
    SELECT product_id FROM product_listing_cache
    WHERE filter_value_ids @> ARRAY[NEW.id] OR color_value_ids @> ARRAY[NEW.id]));
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER attribute_values_queue_search
AFTER UPDATE OF label, slug, swatch_hex ON attribute_values
FOR EACH ROW EXECUTE FUNCTION queue_search_index_value();
--> statement-breakpoint
-- New alt text or a replaced file on a product's first or second image.
CREATE FUNCTION queue_search_index_media() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM queue_search_index(array(
    SELECT product_id FROM product_listing_cache
    WHERE primary_media_id = NEW.id OR hover_media_id = NEW.id));
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER media_assets_queue_search
AFTER UPDATE OF alt_text, storage_key, width, height ON media_assets
FOR EACH ROW EXECUTE FUNCTION queue_search_index_media();
--> statement-breakpoint
-- Every product starts queued, so the first indexer run fills the index.
INSERT INTO search_index_queue (product_id) SELECT id FROM products
ON CONFLICT DO NOTHING;
