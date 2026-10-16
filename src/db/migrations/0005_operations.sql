CREATE TYPE "public"."shipment_direction" AS ENUM('forward', 'reverse', 'replacement');--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('pending', 'ready_to_ship', 'picked_up', 'in_transit', 'out_for_delivery', 'undelivered', 'delivered', 'rto_initiated', 'rto_delivered', 'cancelled', 'lost');--> statement-breakpoint
CREATE TYPE "public"."remittance_source" AS ENUM('api', 'csv', 'manual');--> statement-breakpoint
ALTER TYPE "public"."wallet_reason" ADD VALUE 'order_refund' BEFORE 'expiry';--> statement-breakpoint
CREATE TABLE "provider_tokens" (
	"provider" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipment_items" (
	"shipment_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "shipment_items_shipment_id_order_item_id_pk" PRIMARY KEY("shipment_id","order_item_id"),
	CONSTRAINT "shipment_items_quantity_check" CHECK ("shipment_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "shipment_tracking_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"provider_status" text NOT NULL,
	"status" "shipment_status",
	"location" text,
	"description" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"exchange_id" uuid,
	"direction" "shipment_direction" DEFAULT 'forward' NOT NULL,
	"provider" text NOT NULL,
	"channel_order_id" text NOT NULL,
	"provider_order_id" text,
	"provider_shipment_id" text,
	"awb" text,
	"courier_name" text,
	"status" "shipment_status" DEFAULT 'pending' NOT NULL,
	"cod_amount_paise" integer DEFAULT 0 NOT NULL,
	"weight_grams" integer NOT NULL,
	"length_cm" integer NOT NULL,
	"breadth_cm" integer NOT NULL,
	"height_cm" integer NOT NULL,
	"label_file_key" text,
	"steps" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"customs" jsonb,
	"last_error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_until" timestamp with time zone,
	"pickup_scheduled_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"edd" timestamp with time zone,
	"last_event_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipments_channelOrderId_unique" UNIQUE("channel_order_id"),
	CONSTRAINT "shipments_awb_unique" UNIQUE("awb"),
	CONSTRAINT "shipments_size_check" CHECK ("shipments"."weight_grams" > 0 and "shipments"."length_cm" > 0 and "shipments"."breadth_cm" > 0 and "shipments"."height_cm" > 0 and "shipments"."cod_amount_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "cod_remittances" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"shipment_id" uuid,
	"amount_paise" integer NOT NULL,
	"remitted_at" timestamp with time zone NOT NULL,
	"utr" text NOT NULL,
	"source" "remittance_source" NOT NULL,
	"batch_ref" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cod_remittances_orderId_unique" UNIQUE("order_id"),
	CONSTRAINT "cod_remittances_amount_check" CHECK ("cod_remittances"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "order_notes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"author_user_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_notes_body_check" CHECK (char_length("order_notes"."body") between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "usage_limit" integer;--> statement-breakpoint
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_tracking_events" ADD CONSTRAINT "shipment_tracking_events_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cod_remittances" ADD CONSTRAINT "cod_remittances_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cod_remittances" ADD CONSTRAINT "cod_remittances_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_notes" ADD CONSTRAINT "order_notes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_notes" ADD CONSTRAINT "order_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_tracking_events_dedupe_idx" ON "shipment_tracking_events" USING btree ("shipment_id","provider_status","occurred_at");--> statement-breakpoint
CREATE INDEX "shipment_tracking_events_shipment_idx" ON "shipment_tracking_events" USING btree ("shipment_id","occurred_at");--> statement-breakpoint
CREATE INDEX "shipments_order_idx" ON "shipments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "shipments_active_idx" ON "shipments" USING btree ("status","last_synced_at") WHERE "shipments"."status" not in ('delivered', 'rto_delivered', 'cancelled', 'lost');--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_one_forward_idx" ON "shipments" USING btree ("order_id") WHERE "shipments"."direction" = 'forward' and "shipments"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "cod_remittances_utr_idx" ON "cod_remittances" USING btree ("utr");--> statement-breakpoint
CREATE INDEX "order_notes_order_idx" ON "order_notes" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "coupons_discount_idx" ON "coupons" USING btree ("discount_id");--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_usage_limit_check" CHECK ("coupons"."usage_limit" is null or "coupons"."usage_limit" > 0);--> statement-breakpoint
-- Staff notes and COD remittances are records: the app may add, never edit or delete.
REVOKE UPDATE, DELETE, TRUNCATE ON "order_notes" FROM duis_app;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "cod_remittances" FROM duis_app;
