CREATE TYPE "public"."cod_advance_type" AS ENUM('fixed', 'percent');--> statement-breakpoint
CREATE TYPE "public"."rto_advance_policy" AS ENUM('keep', 'refund', 'wallet');--> statement-breakpoint
CREATE TYPE "public"."discount_applies_to" AS ENUM('all', 'targets');--> statement-breakpoint
CREATE TYPE "public"."discount_kind" AS ENUM('automatic', 'coupon');--> statement-breakpoint
CREATE TYPE "public"."discount_status" AS ENUM('active', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."discount_target_type" AS ENUM('product', 'variant', 'category', 'collection');--> statement-breakpoint
CREATE TYPE "public"."discount_value_type" AS ENUM('percentage', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."coupon_redemption_status" AS ENUM('active', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."fulfillment_status" AS ENUM('unfulfilled', 'partially_fulfilled', 'fulfilled', 'partially_returned', 'returned');--> statement-breakpoint
CREATE TYPE "public"."order_history_field" AS ENUM('status', 'payment_status', 'fulfillment_status');--> statement-breakpoint
CREATE TYPE "public"."order_payment_status" AS ENUM('unpaid', 'partially_paid', 'paid', 'partially_refunded', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending_payment', 'confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'expired', 'rto_initiated', 'rto_delivered');--> statement-breakpoint
CREATE TYPE "public"."payment_mode" AS ENUM('prepaid', 'partial_cod');--> statement-breakpoint
CREATE TYPE "public"."payment_purpose" AS ENUM('full', 'advance', 'exchange_difference');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('created', 'authorized', 'captured', 'failed', 'refunded', 'partially_refunded');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('pending', 'processed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."webhook_status" AS ENUM('received', 'processed', 'ignored', 'failed');--> statement-breakpoint
CREATE TYPE "public"."wallet_reason" AS ENUM('order_payment', 'order_reversal', 'cancellation_refund', 'exchange_credit', 'goodwill', 'rto_advance_credit', 'expiry', 'adjustment');--> statement-breakpoint
CREATE SEQUENCE "public"."order_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 100001 CACHE 1;--> statement-breakpoint
CREATE TABLE "store_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"free_shipping_threshold_paise" integer DEFAULT 99900 NOT NULL,
	"partial_cod_enabled" boolean DEFAULT true NOT NULL,
	"cod_advance_type" "cod_advance_type" DEFAULT 'fixed' NOT NULL,
	"cod_advance_value" integer DEFAULT 10000 NOT NULL,
	"cod_max_order_paise" integer DEFAULT 250000 NOT NULL,
	"cod_fee_paise" integer DEFAULT 500 NOT NULL,
	"reservation_ttl_minutes" integer DEFAULT 15 NOT NULL,
	"exchange_window_days" integer DEFAULT 10 NOT NULL,
	"max_exchanges_per_item" integer DEFAULT 2 NOT NULL,
	"rto_advance_policy" "rto_advance_policy" DEFAULT 'keep' NOT NULL,
	"promo_credit_validity_days" integer DEFAULT 30 NOT NULL,
	"legal_name" text,
	"gstin" text,
	"registered_state_code" text DEFAULT 'IN-UP' NOT NULL,
	"iec_code" text,
	"lut_reference" text,
	"international_country_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_settings_singleton_check" CHECK ("store_settings"."id" = 1),
	CONSTRAINT "store_settings_amounts_check" CHECK ("store_settings"."free_shipping_threshold_paise" >= 0 and "store_settings"."cod_advance_value" >= 0 and "store_settings"."cod_max_order_paise" >= 0 and "store_settings"."cod_fee_paise" >= 0),
	CONSTRAINT "store_settings_ttl_check" CHECK ("store_settings"."reservation_ttl_minutes" between 5 and 60),
	CONSTRAINT "store_settings_state_check" CHECK ("store_settings"."registered_state_code" ~ '^IN-[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "tax_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"hsn_prefix" text NOT NULL,
	"price_threshold_paise" integer,
	"rate_below_bp" integer NOT NULL,
	"rate_above_bp" integer NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_rules_hsn_check" CHECK ("tax_rules"."hsn_prefix" ~ '^[0-9]{2,8}$'),
	CONSTRAINT "tax_rules_rates_check" CHECK ("tax_rules"."rate_below_bp" between 0 and 10000 and "tax_rules"."rate_above_bp" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"discount_id" uuid NOT NULL,
	"code" "citext" NOT NULL,
	"times_used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_code_unique" UNIQUE("code"),
	CONSTRAINT "coupons_code_check" CHECK ("coupons"."code" ~ '^[A-Za-z0-9_-]{3,32}$'),
	CONSTRAINT "coupons_times_used_check" CHECK ("coupons"."times_used" >= 0)
);
--> statement-breakpoint
CREATE TABLE "discount_targets" (
	"discount_id" uuid NOT NULL,
	"target_type" "discount_target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	CONSTRAINT "discount_targets_discount_id_target_type_target_id_pk" PRIMARY KEY("discount_id","target_type","target_id")
);
--> statement-breakpoint
CREATE TABLE "discounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"kind" "discount_kind" NOT NULL,
	"value_type" "discount_value_type" NOT NULL,
	"value" integer NOT NULL,
	"max_discount_paise" integer,
	"min_order_paise" integer DEFAULT 0 NOT NULL,
	"applies_to" "discount_applies_to" DEFAULT 'all' NOT NULL,
	"eligibility" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"combinable" boolean DEFAULT false NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"usage_limit_total" integer,
	"usage_limit_per_customer" integer,
	"status" "discount_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discounts_value_check" CHECK ("discounts"."value" > 0 and ("discounts"."value_type" <> 'percentage' or "discounts"."value" <= 10000)),
	CONSTRAINT "discounts_window_check" CHECK ("discounts"."ends_at" is null or "discounts"."ends_at" > "discounts"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "coupon_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"coupon_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"user_id" uuid,
	"amount_paise" integer NOT NULL,
	"status" "coupon_redemption_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupon_redemptions_orderId_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "order_discounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"discount_id" uuid,
	"coupon_id" uuid,
	"label" text NOT NULL,
	"amount_paise" integer NOT NULL,
	"allocation" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"variant_id" uuid,
	"product_id" uuid,
	"sku" text NOT NULL,
	"title" text NOT NULL,
	"variant_label" text NOT NULL,
	"image_key" text,
	"hsn_code" text NOT NULL,
	"unit_price_paise" integer NOT NULL,
	"unit_mrp_paise" integer NOT NULL,
	"quantity" integer NOT NULL,
	"discount_paise" integer DEFAULT 0 NOT NULL,
	"line_total_paise" integer NOT NULL,
	"tax_rate_bp" integer NOT NULL,
	"taxable_paise" integer NOT NULL,
	"cgst_paise" integer DEFAULT 0 NOT NULL,
	"sgst_paise" integer DEFAULT 0 NOT NULL,
	"igst_paise" integer DEFAULT 0 NOT NULL,
	"exchanged_quantity" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_line_check" CHECK ("order_items"."quantity" > 0 and "order_items"."discount_paise" >= 0 and "order_items"."line_total_paise" = "order_items"."unit_price_paise" * "order_items"."quantity" - "order_items"."discount_paise"),
	CONSTRAINT "order_items_tax_check" CHECK ("order_items"."taxable_paise" + "order_items"."cgst_paise" + "order_items"."sgst_paise" + "order_items"."igst_paise" = "order_items"."line_total_paise")
);
--> statement-breakpoint
CREATE TABLE "order_status_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"field" "order_history_field" NOT NULL,
	"from_value" text,
	"to_value" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_number" text DEFAULT 'DUIS-' || nextval('order_number_seq') NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "order_status" DEFAULT 'pending_payment' NOT NULL,
	"payment_status" "order_payment_status" DEFAULT 'unpaid' NOT NULL,
	"fulfillment_status" "fulfillment_status" DEFAULT 'unfulfilled' NOT NULL,
	"payment_mode" "payment_mode" NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"destination_country" text NOT NULL,
	"is_export" boolean DEFAULT false NOT NULL,
	"subtotal_paise" integer NOT NULL,
	"discount_paise" integer DEFAULT 0 NOT NULL,
	"shipping_fee_paise" integer DEFAULT 0 NOT NULL,
	"cod_fee_paise" integer DEFAULT 0 NOT NULL,
	"tax_total_paise" integer DEFAULT 0 NOT NULL,
	"total_paise" integer NOT NULL,
	"wallet_applied_paise" integer DEFAULT 0 NOT NULL,
	"online_amount_paise" integer NOT NULL,
	"cod_due_paise" integer DEFAULT 0 NOT NULL,
	"fee_tax_rate_bp" integer DEFAULT 0 NOT NULL,
	"fee_taxable_paise" integer DEFAULT 0 NOT NULL,
	"fee_cgst_paise" integer DEFAULT 0 NOT NULL,
	"fee_sgst_paise" integer DEFAULT 0 NOT NULL,
	"fee_igst_paise" integer DEFAULT 0 NOT NULL,
	"coupon_code" "citext",
	"shipping_address" jsonb NOT NULL,
	"customer_name" text NOT NULL,
	"customer_email" text,
	"customer_phone" text,
	"place_idempotency_key" text NOT NULL,
	"quote" jsonb NOT NULL,
	"quote_hash" text NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reservation_expires_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"expired_at" timestamp with time zone,
	"cod_collected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_orderNumber_unique" UNIQUE("order_number"),
	CONSTRAINT "orders_placeIdempotencyKey_unique" UNIQUE("place_idempotency_key"),
	CONSTRAINT "orders_currency_check" CHECK ("orders"."currency" = 'INR'),
	CONSTRAINT "orders_amounts_check" CHECK ("orders"."subtotal_paise" >= 0 and "orders"."discount_paise" >= 0 and "orders"."shipping_fee_paise" >= 0 and "orders"."cod_fee_paise" >= 0 and "orders"."wallet_applied_paise" >= 0 and "orders"."online_amount_paise" >= 0 and "orders"."cod_due_paise" >= 0),
	CONSTRAINT "orders_total_check" CHECK ("orders"."total_paise" = "orders"."subtotal_paise" - "orders"."discount_paise" + "orders"."shipping_fee_paise" + "orders"."cod_fee_paise"),
	CONSTRAINT "orders_split_check" CHECK ("orders"."wallet_applied_paise" + "orders"."online_amount_paise" + "orders"."cod_due_paise" = "orders"."total_paise"),
	CONSTRAINT "orders_cod_check" CHECK ("orders"."payment_mode" = 'partial_cod' or "orders"."cod_due_paise" = 0),
	CONSTRAINT "orders_export_check" CHECK ("orders"."is_export" = ("orders"."destination_country" <> 'IN') and (not "orders"."is_export" or "orders"."payment_mode" = 'prepaid'))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"purpose" "payment_purpose" NOT NULL,
	"provider" text NOT NULL,
	"provider_order_id" text NOT NULL,
	"provider_payment_id" text,
	"amount_paise" integer NOT NULL,
	"refunded_paise" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" "payment_status" DEFAULT 'created' NOT NULL,
	"method" text,
	"error_code" text,
	"error_reason" text,
	"captured_at" timestamp with time zone,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_providerOrderId_unique" UNIQUE("provider_order_id"),
	CONSTRAINT "payments_providerPaymentId_unique" UNIQUE("provider_payment_id"),
	CONSTRAINT "payments_amount_check" CHECK ("payments"."amount_paise" > 0 and "payments"."refunded_paise" between 0 and "payments"."amount_paise")
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"payment_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"amount_paise" integer NOT NULL,
	"reason" text NOT NULL,
	"status" "refund_status" DEFAULT 'pending' NOT NULL,
	"provider_refund_id" text,
	"idempotency_key" text NOT NULL,
	"initiated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_providerRefundId_unique" UNIQUE("provider_refund_id"),
	CONSTRAINT "refunds_idempotencyKey_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "refunds_amount_check" CHECK ("refunds"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "webhook_status" DEFAULT 'received' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "wallet_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"balance_paise" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_accounts_balance_check" CHECK ("wallet_accounts"."balance_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "wallet_credit_lots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"ledger_id" uuid NOT NULL,
	"amount_paise" integer NOT NULL,
	"remaining_paise" integer NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_credit_lots_ledgerId_unique" UNIQUE("ledger_id"),
	CONSTRAINT "wallet_credit_lots_remaining_check" CHECK ("wallet_credit_lots"."amount_paise" > 0 and "wallet_credit_lots"."remaining_paise" between 0 and "wallet_credit_lots"."amount_paise")
);
--> statement-breakpoint
CREATE TABLE "wallet_ledger" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"amount_paise" integer NOT NULL,
	"reason" "wallet_reason" NOT NULL,
	"reference_type" text,
	"reference_id" uuid,
	"idempotency_key" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_ledger_idempotencyKey_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "wallet_ledger_amount_check" CHECK ("wallet_ledger"."amount_paise" <> 0)
);
--> statement-breakpoint
CREATE TABLE "wallet_lot_usages" (
	"debit_ledger_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"amount_paise" integer NOT NULL,
	CONSTRAINT "wallet_lot_usages_debit_ledger_id_lot_id_pk" PRIMARY KEY("debit_ledger_id","lot_id"),
	CONSTRAINT "wallet_lot_usages_amount_check" CHECK ("wallet_lot_usages"."amount_paise" > 0)
);
--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_discount_id_discounts_id_fk" FOREIGN KEY ("discount_id") REFERENCES "public"."discounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_targets" ADD CONSTRAINT "discount_targets_discount_id_discounts_id_fk" FOREIGN KEY ("discount_id") REFERENCES "public"."discounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_discounts" ADD CONSTRAINT "order_discounts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_discounts" ADD CONSTRAINT "order_discounts_discount_id_discounts_id_fk" FOREIGN KEY ("discount_id") REFERENCES "public"."discounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_discounts" ADD CONSTRAINT "order_discounts_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_initiated_by_users_id_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_accounts" ADD CONSTRAINT "wallet_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_credit_lots" ADD CONSTRAINT "wallet_credit_lots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_credit_lots" ADD CONSTRAINT "wallet_credit_lots_ledger_id_wallet_ledger_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."wallet_ledger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_ledger" ADD CONSTRAINT "wallet_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_ledger" ADD CONSTRAINT "wallet_ledger_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_lot_usages" ADD CONSTRAINT "wallet_lot_usages_debit_ledger_id_wallet_ledger_id_fk" FOREIGN KEY ("debit_ledger_id") REFERENCES "public"."wallet_ledger"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_lot_usages" ADD CONSTRAINT "wallet_lot_usages_lot_id_wallet_credit_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."wallet_credit_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tax_rules_hsn_idx" ON "tax_rules" USING btree ("hsn_prefix","effective_from");--> statement-breakpoint
CREATE INDEX "discount_targets_target_idx" ON "discount_targets" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "discounts_active_idx" ON "discounts" USING btree ("kind","status","starts_at");--> statement-breakpoint
CREATE INDEX "coupon_redemptions_user_idx" ON "coupon_redemptions" USING btree ("coupon_id","user_id");--> statement-breakpoint
CREATE INDEX "order_discounts_order_idx" ON "order_discounts" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id","position");--> statement-breakpoint
CREATE INDEX "order_items_variant_idx" ON "order_items" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "order_status_history_order_idx" ON "order_status_history" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_user_idx" ON "orders" USING btree ("user_id","placed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status","placed_at");--> statement-breakpoint
CREATE INDEX "orders_pending_expiry_idx" ON "orders" USING btree ("reservation_expires_at") WHERE "orders"."status" = 'pending_payment';--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "refunds_order_idx" ON "refunds" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_provider_event_idx" ON "webhook_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE INDEX "webhook_events_status_idx" ON "webhook_events" USING btree ("status","received_at");--> statement-breakpoint
CREATE INDEX "wallet_credit_lots_open_idx" ON "wallet_credit_lots" USING btree ("user_id","expires_at") WHERE "wallet_credit_lots"."remaining_paise" > 0;--> statement-breakpoint
CREATE INDEX "wallet_ledger_user_idx" ON "wallet_ledger" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;