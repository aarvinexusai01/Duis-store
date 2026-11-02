CREATE TABLE "data_consents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid,
	"subject_hash" text,
	"purpose" text NOT NULL,
	"granted" boolean NOT NULL,
	"notice_version" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"source" text NOT NULL,
	"reference_type" text,
	"reference_id" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_consents_who_check" CHECK ("data_consents"."user_id" is not null or "data_consents"."subject_hash" is not null),
	CONSTRAINT "data_consents_purpose_check" CHECK ("data_consents"."purpose" in ('account', 'age', 'order', 'address', 'contact', 'stock_alert', 'review', 'exchange', 'marketing', 'marketing_whatsapp', 'whatsapp_updates')),
	CONSTRAINT "data_consents_language_check" CHECK ("data_consents"."language" in ('en', 'hi'))
);
--> statement-breakpoint
ALTER TABLE "data_consents" ADD CONSTRAINT "data_consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_consents_user_idx" ON "data_consents" USING btree ("user_id","purpose","created_at");--> statement-breakpoint
CREATE INDEX "data_consents_subject_idx" ON "data_consents" USING btree ("subject_hash");--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "data_consents" FROM duis_app;
