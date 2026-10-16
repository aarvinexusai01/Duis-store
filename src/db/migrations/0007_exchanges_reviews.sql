CREATE TYPE "public"."exchange_reason" AS ENUM('too_small', 'too_large', 'colour', 'damaged', 'wrong_item', 'other');--> statement-breakpoint
CREATE TYPE "public"."exchange_status" AS ENUM('requested', 'awaiting_payment', 'approved', 'rejected', 'cancelled', 'pickup_scheduled', 'picked_up', 'received', 'qc_passed', 'qc_failed', 'replacement_shipped', 'completed');--> statement-breakpoint
CREATE TYPE "public"."review_fit" AS ENUM('runs_small', 'true_to_size', 'runs_large');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE SEQUENCE "public"."exchange_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 100001 CACHE 1;--> statement-breakpoint
CREATE TABLE "customer_photos" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"file_key" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exchange_request_photos" (
	"exchange_id" uuid NOT NULL,
	"photo_id" uuid NOT NULL,
	CONSTRAINT "exchange_request_photos_exchange_id_photo_id_pk" PRIMARY KEY("exchange_id","photo_id")
);
--> statement-breakpoint
CREATE TABLE "exchange_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"exchange_number" text DEFAULT 'EX-' || nextval('exchange_number_seq') NOT NULL,
	"order_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"requested_variant_id" uuid NOT NULL,
	"reason" "exchange_reason" NOT NULL,
	"customer_note" text,
	"status" "exchange_status" DEFAULT 'requested' NOT NULL,
	"price_difference_paise" integer DEFAULT 0 NOT NULL,
	"difference_payment_id" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"qc_note" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_requests_exchangeNumber_unique" UNIQUE("exchange_number"),
	CONSTRAINT "exchange_requests_quantity_check" CHECK ("exchange_requests"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "review_photos" (
	"review_id" uuid NOT NULL,
	"photo_id" uuid NOT NULL,
	CONSTRAINT "review_photos_review_id_photo_id_pk" PRIMARY KEY("review_id","photo_id")
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"product_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"title" text,
	"body" text NOT NULL,
	"fit" "review_fit",
	"display_name" text NOT NULL,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"moderated_by" uuid,
	"moderated_at" timestamp with time zone,
	"moderation_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_orderItemId_unique" UNIQUE("order_item_id"),
	CONSTRAINT "reviews_rating_check" CHECK ("reviews"."rating" between 1 and 5),
	CONSTRAINT "reviews_body_check" CHECK (char_length("reviews"."body") between 10 and 2000)
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "rating_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "rating_average" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "review_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_photos" ADD CONSTRAINT "customer_photos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_request_photos" ADD CONSTRAINT "exchange_request_photos_exchange_id_exchange_requests_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "public"."exchange_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_request_photos" ADD CONSTRAINT "exchange_request_photos_photo_id_customer_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."customer_photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_requests" ADD CONSTRAINT "exchange_requests_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_requests" ADD CONSTRAINT "exchange_requests_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_requests" ADD CONSTRAINT "exchange_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_requests" ADD CONSTRAINT "exchange_requests_requested_variant_id_product_variants_id_fk" FOREIGN KEY ("requested_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_requests" ADD CONSTRAINT "exchange_requests_difference_payment_id_payments_id_fk" FOREIGN KEY ("difference_payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_requests" ADD CONSTRAINT "exchange_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_photos" ADD CONSTRAINT "review_photos_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_photos" ADD CONSTRAINT "review_photos_photo_id_customer_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."customer_photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_moderated_by_users_id_fk" FOREIGN KEY ("moderated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_photos_user_idx" ON "customer_photos" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "exchange_requests_order_idx" ON "exchange_requests" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "exchange_requests_status_idx" ON "exchange_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_requests_one_open_idx" ON "exchange_requests" USING btree ("order_item_id") WHERE "exchange_requests"."status" not in ('rejected', 'cancelled', 'completed', 'qc_failed');--> statement-breakpoint
CREATE INDEX "reviews_product_idx" ON "reviews" USING btree ("product_id","status","created_at");--> statement-breakpoint
CREATE INDEX "reviews_status_idx" ON "reviews" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_exchange_id_exchange_requests_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "public"."exchange_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_exchange_id_exchange_requests_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "public"."exchange_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_reservations_exchange_idx" ON "inventory_reservations" USING btree ("exchange_id");--> statement-breakpoint
CREATE INDEX "shipments_exchange_idx" ON "shipments" USING btree ("exchange_id");