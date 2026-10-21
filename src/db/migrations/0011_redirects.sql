CREATE TABLE "redirects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"from_path" text NOT NULL,
	"to_path" text NOT NULL,
	"status_code" smallint DEFAULT 301 NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"last_hit_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "redirects_fromPath_unique" UNIQUE("from_path"),
	CONSTRAINT "redirects_status_check" CHECK ("redirects"."status_code" in (301, 302)),
	CONSTRAINT "redirects_source_check" CHECK ("redirects"."source" in ('auto', 'manual')),
	CONSTRAINT "redirects_from_check" CHECK ("redirects"."from_path" ~ '^/[^?#[:space:]]*$'),
	CONSTRAINT "redirects_to_check" CHECK ("redirects"."to_path" ~ '^(/[^[:space:]]*|https://[^[:space:]]+)$'),
	CONSTRAINT "redirects_no_loop_check" CHECK ("redirects"."from_path" <> "redirects"."to_path")
);
--> statement-breakpoint
ALTER TABLE "redirects" ADD CONSTRAINT "redirects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;