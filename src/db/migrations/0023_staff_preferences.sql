CREATE TABLE "staff_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"helper_hidden" boolean DEFAULT false NOT NULL,
	"tour_completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff_preferences" ADD CONSTRAINT "staff_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;