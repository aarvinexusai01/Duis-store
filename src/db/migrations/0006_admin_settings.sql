CREATE TABLE "staff_invitations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" "citext" NOT NULL,
	"roles" text[] NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_invitations_tokenHash_unique" UNIQUE("token_hash"),
	CONSTRAINT "staff_invitations_roles_check" CHECK (cardinality("staff_invitations"."roles") > 0 and not ('customer' = any("staff_invitations"."roles")))
);
--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "email_sender_name" text DEFAULT 'Duis' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "email_reply_to" text;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "notify_order_shipped" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "notify_payment_reminder" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "notify_low_stock" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_accepted_user_id_users_id_fk" FOREIGN KEY ("accepted_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_invitations_email_idx" ON "staff_invitations" USING btree ("email","created_at");