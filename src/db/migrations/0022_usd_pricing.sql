CREATE TABLE "country_pricing" (
	"country_code" text PRIMARY KEY NOT NULL,
	"uplift_bp" integer,
	"shipping_fee_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "country_pricing_check" CHECK ("country_pricing"."country_code" ~ '^[A-Z]{2}$' and "country_pricing"."country_code" <> 'IN' and ("country_pricing"."uplift_bp" is null or "country_pricing"."uplift_bp" between 0 and 10000) and "country_pricing"."shipping_fee_cents" between 0 and 1000000)
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"base" text DEFAULT 'USD' NOT NULL,
	"quote" text DEFAULT 'INR' NOT NULL,
	"rate_micros" integer NOT NULL,
	"as_of" date NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rates_rate_check" CHECK ("fx_rates"."rate_micros" > 0)
);
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_currency_check";--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "usd_pricing_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "usd_rate_mode" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "usd_manual_rate_micros" integer;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "default_uplift_bp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "order_discounts" ADD COLUMN "amount_minor" integer;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "unit_price_minor" integer;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "unit_mrp_minor" integer;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "discount_minor" integer;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "line_total_minor" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fx_rate_micros" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fx_source" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fx_as_of" date;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "price_uplift_bp" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "subtotal_minor" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "discount_minor" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipping_fee_minor" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "total_minor" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "online_amount_minor" integer;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "currency" text DEFAULT 'INR' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "fx_rates_day_key" ON "fx_rates" USING btree ("base","quote","as_of");--> statement-breakpoint
ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_usd_check" CHECK ("store_settings"."usd_rate_mode" in ('auto', 'manual') and ("store_settings"."usd_manual_rate_micros" is null or "store_settings"."usd_manual_rate_micros" between 10000000 and 500000000) and "store_settings"."default_uplift_bp" between 0 and 10000);--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_minor_check" CHECK ("order_items"."line_total_minor" is null or ("order_items"."discount_minor" >= 0 and "order_items"."line_total_minor" = "order_items"."unit_price_minor" * "order_items"."quantity" - "order_items"."discount_minor"));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_minor_check" CHECK ("orders"."currency" = 'INR' or ("orders"."fx_rate_micros" > 0 and "orders"."fx_source" is not null and "orders"."fx_as_of" is not null and "orders"."price_uplift_bp" is not null
        and "orders"."subtotal_minor" >= 0 and "orders"."discount_minor" >= 0 and "orders"."shipping_fee_minor" >= 0
        and "orders"."total_minor" = "orders"."subtotal_minor" - "orders"."discount_minor" + "orders"."shipping_fee_minor"
        and "orders"."online_amount_minor" = "orders"."total_minor" and "orders"."wallet_applied_paise" = 0 and "orders"."payment_mode" = 'prepaid'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_currency_check" CHECK ("orders"."currency" in ('INR', 'USD') and ("orders"."currency" = 'INR' or "orders"."is_export"));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_currency_check" CHECK ("payments"."currency" in ('INR', 'USD'));