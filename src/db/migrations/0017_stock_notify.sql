-- Product pages keep stock in Redis (ADR-0033). Every change to a variant's
-- stock, from any code path or by hand, notifies "duis_stock" with the
-- variant id; the worker's listener deletes that variant's cached stock.
-- Postgres delivers a notification only when its transaction commits, and
-- sends identical ones from one transaction once.
CREATE FUNCTION notify_stock_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM pg_notify('duis_stock', OLD.variant_id::text);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM pg_notify('duis_stock', NEW.variant_id::text);
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER inventory_levels_notify_stock
AFTER INSERT OR DELETE OR UPDATE OF on_hand, reserved, variant_id, location_id
ON inventory_levels
FOR EACH ROW EXECUTE FUNCTION notify_stock_changed();
--> statement-breakpoint
-- Availability counts active locations only, so switching one on or off
-- changes every variant stocked there: "*" clears all cached stock.
CREATE FUNCTION notify_stock_locations_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('duis_stock', '*');
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER stock_locations_notify_stock
AFTER UPDATE OF is_active ON stock_locations
FOR EACH ROW WHEN (OLD.is_active IS DISTINCT FROM NEW.is_active)
EXECUTE FUNCTION notify_stock_locations_changed();
