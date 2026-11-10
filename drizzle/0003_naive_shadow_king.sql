ALTER TABLE "outbound_messages" ADD COLUMN "provider_message_id" text;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD COLUMN "last_error" text;