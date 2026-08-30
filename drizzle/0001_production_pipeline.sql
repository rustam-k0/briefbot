-- Data-preserving migration from the MVP schema.
ALTER TYPE "brief_status" ADD VALUE IF NOT EXISTS 'archived';
ALTER TYPE "field_status" RENAME TO "field_status_legacy";
CREATE TYPE "field_status" AS ENUM ('confirmed','inferred','missing','conflicting','skipped','not_applicable');
ALTER TABLE "brief_field_values" ALTER COLUMN "status" TYPE "field_status" USING (
  CASE "status"::text WHEN 'unknown' THEN 'missing' WHEN 'declined' THEN 'skipped' ELSE "status"::text END
)::"field_status";
DROP TYPE "field_status_legacy";
CREATE TYPE "message_source" AS ENUM ('text','voice');
CREATE TYPE "pipeline_stage" AS ENUM ('received','audio_saved','transcribing','transcribed','extracting','extracted','saving','completed','failed');
CREATE TYPE "locale" AS ENUM ('ru','en');

ALTER TABLE "telegram_users" ADD COLUMN "locale" locale NOT NULL DEFAULT 'ru';
ALTER TABLE "chats" ADD COLUMN "active_brief_id" uuid;
ALTER TABLE "briefs" ADD COLUMN "title" text;
ALTER TABLE "briefs" ADD COLUMN "short_code" text;
ALTER TABLE "briefs" ADD COLUMN "template_key" text;
ALTER TABLE "briefs" ADD COLUMN "template_version" integer;
ALTER TABLE "briefs" ADD COLUMN "template_snapshot" jsonb;

UPDATE "briefs" SET
  "title"=COALESCE(NULLIF("fields"->'business.projectName'->>'value',''),'Бриф без названия'),
  "short_code"=upper(substr(md5("id"::text),1,6)), "template_key"='website-design', "template_version"=1;

WITH template(definition) AS (VALUES ($json$
{"key":"website-design","version":1,"name":{"ru":"Бриф на сайт","en":"Website brief"},"description":{"ru":"Цели, аудитория, объём, стиль, сроки и бюджет","en":"Goals, audience, scope, style, timeline and budget"},"sections":[{"id":"business","title":{"ru":"Бизнес и продукт","en":"Business and product"},"order":0,"enabled":true},{"id":"audience","title":{"ru":"Аудитория","en":"Audience"},"order":1,"enabled":true},{"id":"scope","title":{"ru":"Объём работ","en":"Scope"},"order":2,"enabled":true},{"id":"functionality","title":{"ru":"Функции","en":"Functionality"},"order":3,"enabled":true},{"id":"content","title":{"ru":"Контент","en":"Content"},"order":4,"enabled":true},{"id":"visual","title":{"ru":"Визуальное направление","en":"Visual direction"},"order":5,"enabled":true},{"id":"constraints","title":{"ru":"Сроки и бюджет","en":"Timeline and budget"},"order":6,"enabled":true},{"id":"approval","title":{"ru":"Согласование","en":"Approval"},"order":7,"enabled":true}],"fields":[{"id":"business.product","sectionId":"business","label":{"ru":"Продукт или услуга","en":"Product or service"},"type":"long_text","required":true,"weight":1,"modelMayInfer":false,"requiresConfirmation":false,"enabled":true,"order":1},{"id":"business.siteGoal","sectionId":"business","label":{"ru":"Цель сайта","en":"Website goal"},"type":"long_text","required":true,"weight":1,"modelMayInfer":false,"requiresConfirmation":false,"enabled":true,"order":2},{"id":"audience.primarySegments","sectionId":"audience","label":{"ru":"Основная аудитория","en":"Primary audience"},"type":"long_text","required":true,"weight":1,"modelMayInfer":false,"requiresConfirmation":false,"enabled":true,"order":0},{"id":"scope.siteType","sectionId":"scope","label":{"ru":"Формат сайта","en":"Website type"},"type":"long_text","required":true,"weight":1,"modelMayInfer":true,"requiresConfirmation":true,"enabled":true,"order":0},{"id":"scope.pages","sectionId":"scope","label":{"ru":"Страницы","en":"Pages"},"type":"long_text","required":true,"weight":1,"modelMayInfer":false,"requiresConfirmation":false,"enabled":true,"order":1},{"id":"functionality.forms","sectionId":"functionality","label":{"ru":"Способ получения заявок","en":"Lead capture"},"type":"long_text","required":true,"weight":1,"modelMayInfer":false,"requiresConfirmation":false,"enabled":true,"order":0},{"id":"content.readiness","sectionId":"content","label":{"ru":"Готовность контента","en":"Content readiness"},"type":"long_text","required":true,"weight":1,"modelMayInfer":false,"requiresConfirmation":false,"enabled":true,"order":0},{"id":"visualDirection.impression","sectionId":"visual","label":{"ru":"Желаемое впечатление","en":"Desired impression"},"type":"long_text","required":true,"weight":1,"modelMayInfer":false,"requiresConfirmation":false,"enabled":true,"order":0},{"id":"constraints.launchDate","sectionId":"constraints","label":{"ru":"Срок запуска","en":"Launch date"},"type":"long_text","required":true,"weight":1,"modelMayInfer":false,"requiresConfirmation":false,"enabled":true,"order":0},{"id":"constraints.budget","sectionId":"constraints","label":{"ru":"Бюджет","en":"Budget"},"type":"long_text","required":true,"weight":1,"modelMayInfer":false,"requiresConfirmation":false,"enabled":true,"order":1},{"id":"approvalProcess.finalDecisionMaker","sectionId":"approval","label":{"ru":"Кто принимает решение","en":"Final decision maker"},"type":"long_text","required":true,"weight":1,"modelMayInfer":false,"requiresConfirmation":false,"enabled":true,"order":0}]}
$json$::jsonb)) UPDATE "briefs" SET "template_snapshot"=template.definition FROM template;

ALTER TABLE "briefs" ALTER COLUMN "title" SET NOT NULL;
ALTER TABLE "briefs" ALTER COLUMN "short_code" SET NOT NULL;
ALTER TABLE "briefs" ALTER COLUMN "template_key" SET NOT NULL;
ALTER TABLE "briefs" ALTER COLUMN "template_version" SET NOT NULL;
ALTER TABLE "briefs" ALTER COLUMN "template_snapshot" SET NOT NULL;
DROP INDEX IF EXISTS "one_active_brief_per_chat";
CREATE INDEX "briefs_chat_status_idx" ON "briefs"("chat_id","status");
CREATE UNIQUE INDEX "brief_short_code_chat_unique" ON "briefs"("chat_id","short_code");
UPDATE "chats" c SET "active_brief_id"=(SELECT b.id FROM "briefs" b WHERE b.chat_id=c.id AND b.status='active' ORDER BY b.updated_at DESC LIMIT 1);
ALTER TABLE "chats" ADD CONSTRAINT "chats_active_brief_fk" FOREIGN KEY ("active_brief_id") REFERENCES "briefs"("id") ON DELETE SET NULL;

CREATE TABLE "brief_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "owner_user_id" uuid REFERENCES "telegram_users"("id") ON DELETE CASCADE,
  "key" text NOT NULL, "version" integer NOT NULL, "definition" jsonb NOT NULL, "built_in" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "template_owner_key_version_unique" ON "brief_templates"("owner_user_id","key","version");
CREATE TABLE "brief_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "brief_id" uuid NOT NULL REFERENCES "briefs"("id") ON DELETE CASCADE,
  "started_at" timestamptz NOT NULL DEFAULT now(), "ended_at" timestamptz, "last_activity_at" timestamptz NOT NULL DEFAULT now(), "model_session_id" text
);
INSERT INTO "brief_sessions"("brief_id","started_at","last_activity_at","model_session_id")
SELECT b.id,b.created_at,b.updated_at,(SELECT o.session_id FROM opencode_sessions o WHERE o.brief_id=b.id AND o.active=true ORDER BY o.created_at DESC LIMIT 1) FROM briefs b;
CREATE INDEX "brief_session_active_idx" ON "brief_sessions"("brief_id","ended_at");

ALTER TABLE "messages" RENAME COLUMN "external_id" TO "telegram_message_id";
ALTER TABLE "messages" ADD COLUMN "update_id" bigint;
ALTER TABLE "messages" ADD COLUMN "user_id" uuid;
ALTER TABLE "messages" ADD COLUMN "session_id" uuid;
ALTER TABLE "messages" ADD COLUMN "source" message_source;
ALTER TABLE "messages" ADD COLUMN "telegram_file_id" text;
ALTER TABLE "messages" ADD COLUMN "stored_file_path" text;
ALTER TABLE "messages" ADD COLUMN "language" text;
ALTER TABLE "messages" ADD COLUMN "stage" pipeline_stage;
ALTER TABLE "messages" ADD COLUMN "failed_stage" pipeline_stage;
ALTER TABLE "messages" ADD COLUMN "error_code" text;
ALTER TABLE "messages" ADD COLUMN "attempts" integer NOT NULL DEFAULT 0;
ALTER TABLE "messages" ADD COLUMN "extracted" jsonb;
ALTER TABLE "messages" ADD COLUMN "apply_result" jsonb;
ALTER TABLE "messages" ADD COLUMN "model_calls" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "messages" RENAME COLUMN "created_at" TO "received_at";
ALTER TABLE "messages" ADD COLUMN "updated_at" timestamptz NOT NULL DEFAULT now();
ALTER TABLE "messages" ADD COLUMN "completed_at" timestamptz;
WITH numbered AS (SELECT id,-row_number() OVER (ORDER BY received_at,id) n FROM messages) UPDATE messages m SET update_id=numbered.n FROM numbered WHERE m.id=numbered.id;
UPDATE messages m SET user_id=c.user_id,session_id=(SELECT s.id FROM brief_sessions s WHERE s.brief_id=m.brief_id ORDER BY s.started_at LIMIT 1),source=CASE WHEN transcript IS NULL THEN 'text'::message_source ELSE 'voice'::message_source END,stage='completed',completed_at=received_at FROM chats c WHERE c.id=m.chat_id;
ALTER TABLE "messages" ALTER COLUMN "update_id" SET NOT NULL;
ALTER TABLE "messages" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "messages" ALTER COLUMN "session_id" SET NOT NULL;
ALTER TABLE "messages" ALTER COLUMN "source" SET NOT NULL;
ALTER TABLE "messages" ALTER COLUMN "stage" SET NOT NULL;
ALTER TABLE "messages" ALTER COLUMN "stage" SET DEFAULT 'received';
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_fk" FOREIGN KEY ("user_id") REFERENCES "telegram_users"("id") ON DELETE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_session_fk" FOREIGN KEY ("session_id") REFERENCES "brief_sessions"("id") ON DELETE CASCADE;
DROP INDEX IF EXISTS "messages_brief_external_unique";
DROP INDEX IF EXISTS "messages_history_idx";
CREATE UNIQUE INDEX "messages_update_unique" ON "messages"("update_id");
CREATE UNIQUE INDEX "messages_chat_telegram_message_unique" ON "messages"("chat_id","telegram_message_id");
CREATE INDEX "messages_brief_received_idx" ON "messages"("brief_id","received_at");
CREATE INDEX "messages_recovery_idx" ON "messages"("stage","updated_at");

ALTER TABLE "brief_field_values" RENAME COLUMN "path" TO "field_id";
ALTER TABLE "brief_field_values" ADD COLUMN "source_quote" text;
ALTER TABLE "brief_field_values" ADD COLUMN "reason" text;
DROP INDEX IF EXISTS "brief_field_path_unique";
CREATE UNIQUE INDEX "brief_field_id_unique" ON "brief_field_values"("brief_id","field_id");
CREATE TABLE "brief_field_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "brief_id" uuid NOT NULL REFERENCES "briefs"("id") ON DELETE CASCADE,
  "field_id" text NOT NULL, "message_id" uuid NOT NULL REFERENCES "messages"("id") ON DELETE CASCADE,
  "previous" jsonb, "next" jsonb NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "field_history_brief_idx" ON "brief_field_history"("brief_id","field_id","created_at");
ALTER TABLE "brief_snapshots" ADD COLUMN "template_snapshot" jsonb;
ALTER TABLE "brief_snapshots" DISABLE TRIGGER "brief_snapshots_immutable";
UPDATE "brief_snapshots" s SET "template_snapshot"=b.template_snapshot FROM briefs b WHERE b.id=s.brief_id;
ALTER TABLE "brief_snapshots" ENABLE TRIGGER "brief_snapshots_immutable";
ALTER TABLE "brief_snapshots" ALTER COLUMN "template_snapshot" SET NOT NULL;
DROP TABLE "opencode_sessions";
-- Keep legacy processed_updates for a safe deduplication grace period; new code no longer writes it.
