CREATE TYPE "public"."brief_status" AS ENUM('active', 'finalized', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."field_status" AS ENUM('confirmed', 'inferred', 'unknown', 'declined');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TABLE "brief_field_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brief_id" uuid NOT NULL,
	"path" text NOT NULL,
	"value" jsonb NOT NULL,
	"status" "field_status" NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"source_message_ids" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "confidence_range" CHECK ("brief_field_values"."confidence" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "brief_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brief_id" uuid NOT NULL,
	"chat_id" uuid NOT NULL,
	"fields" jsonb NOT NULL,
	"markdown" text NOT NULL,
	"message_ids" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brief_snapshots_brief_id_unique" UNIQUE("brief_id")
);
--> statement-breakpoint
CREATE TABLE "briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"status" "brief_status" DEFAULT 'active' NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"preview_markdown" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone,
	CONSTRAINT "brief_progress_range" CHECK ("briefs"."progress" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_chat_id" bigint NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chats_telegram_chat_id_unique" UNIQUE("telegram_chat_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text NOT NULL,
	"chat_id" uuid NOT NULL,
	"brief_id" uuid NOT NULL,
	"role" "message_role" NOT NULL,
	"raw_text" text,
	"transcript" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opencode_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brief_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_updates" (
	"update_id" bigint PRIMARY KEY NOT NULL,
	"chat_id" uuid NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_id" bigint NOT NULL,
	"username" text,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_users_telegram_id_unique" UNIQUE("telegram_id")
);
--> statement-breakpoint
ALTER TABLE "brief_field_values" ADD CONSTRAINT "brief_field_values_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."briefs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_snapshots" ADD CONSTRAINT "brief_snapshots_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."briefs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_snapshots" ADD CONSTRAINT "brief_snapshots_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_user_id_telegram_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."telegram_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."briefs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opencode_sessions" ADD CONSTRAINT "opencode_sessions_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."briefs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processed_updates" ADD CONSTRAINT "processed_updates_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brief_field_path_unique" ON "brief_field_values" USING btree ("brief_id","path");--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_brief_per_chat" ON "briefs" USING btree ("chat_id") WHERE "briefs"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "messages_brief_external_unique" ON "messages" USING btree ("brief_id","external_id");--> statement-breakpoint
CREATE INDEX "messages_history_idx" ON "messages" USING btree ("brief_id","created_at");--> statement-breakpoint
CREATE INDEX "opencode_session_brief_idx" ON "opencode_sessions" USING btree ("brief_id","active");
--> statement-breakpoint
CREATE FUNCTION prevent_brief_snapshot_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'brief snapshots are immutable';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER brief_snapshots_immutable BEFORE UPDATE ON "brief_snapshots"
FOR EACH ROW EXECUTE FUNCTION prevent_brief_snapshot_update();
