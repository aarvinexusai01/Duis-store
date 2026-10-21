CREATE TABLE "ops_checks" (
	"key" text PRIMARY KEY NOT NULL,
	"ok" boolean NOT NULL,
	"detail" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_ok_at" timestamp with time zone,
	"alerted_at" timestamp with time zone
);
