CREATE TYPE "public"."contact_message_status" AS ENUM('new', 'replied', 'closed');--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"visitor_id" uuid NOT NULL,
	"user_id" uuid,
	"analytics" boolean NOT NULL,
	"marketing" boolean NOT NULL,
	"version" integer NOT NULL,
	"source" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_records_source_check" CHECK ("consent_records"."source" in ('banner', 'settings'))
);
--> statement-breakpoint
CREATE TABLE "contact_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"email" "citext" NOT NULL,
	"phone" text,
	"order_number" text,
	"topic" text NOT NULL,
	"message" text NOT NULL,
	"user_id" uuid,
	"status" "contact_message_status" DEFAULT 'new' NOT NULL,
	"handled_by" uuid,
	"handled_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_messages_topic_check" CHECK ("contact_messages"."topic" in ('order', 'exchange', 'product', 'other')),
	CONSTRAINT "contact_messages_length_check" CHECK (char_length("contact_messages"."message") between 1 and 5000)
);
--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "support_email" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "marketing_context" jsonb;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_records_visitor_idx" ON "consent_records" USING btree ("visitor_id","created_at");--> statement-breakpoint
CREATE INDEX "consent_records_user_idx" ON "consent_records" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "contact_messages_status_idx" ON "contact_messages" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "contact_messages_email_idx" ON "contact_messages" USING btree ("email");--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "consent_records" FROM duis_app;
