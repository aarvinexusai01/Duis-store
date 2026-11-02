ALTER TABLE "contact_messages" DROP CONSTRAINT "contact_messages_topic_check";--> statement-breakpoint
ALTER TABLE "data_consents" DROP CONSTRAINT "data_consents_purpose_check";--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD COLUMN "erased_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD COLUMN "nominee_name" text;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD COLUMN "nominee_contact" text;--> statement-breakpoint
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_topic_check" CHECK ("contact_messages"."topic" in ('order', 'exchange', 'product', 'privacy', 'other'));--> statement-breakpoint
ALTER TABLE "data_consents" ADD CONSTRAINT "data_consents_purpose_check" CHECK ("data_consents"."purpose" in ('account', 'age', 'order', 'address', 'contact', 'stock_alert', 'review', 'exchange', 'marketing', 'marketing_whatsapp', 'whatsapp_updates', 'nominee'));