CREATE TABLE "otp_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"phone_hash" text NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_alerts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"variant_id" uuid NOT NULL,
	"user_id" uuid,
	"email" "citext" NOT NULL,
	"whatsapp" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD COLUMN "whatsapp_updates_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "reminder_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "last_reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "otp_requests_phone_idx" ON "otp_requests" USING btree ("phone_hash","created_at");--> statement-breakpoint
CREATE INDEX "otp_requests_ip_idx" ON "otp_requests" USING btree ("ip","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_alerts_pending_idx" ON "stock_alerts" USING btree ("variant_id","email") WHERE "stock_alerts"."notified_at" is null;--> statement-breakpoint
CREATE INDEX "stock_alerts_variant_idx" ON "stock_alerts" USING btree ("variant_id","notified_at");