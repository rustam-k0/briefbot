# BriefBot

Production-oriented Telegram bot for collecting versioned website briefs from Russian, English, mixed text, and Telegram OGG/Opus voice messages.

## What changed

- Every update is persisted before transcription or LLM calls and bound to a user, chat, selected brief, and 30-minute activity session.
- PostgreSQL uniqueness plus advisory transaction locks provide update idempotency and per-brief ordering across application instances.
- Voice files are stored with `0600` permissions. A successful transcript is reused when extraction fails; failed text/transcript jobs are recovered automatically up to three attempts.
- Qwen models from Alibaba are allowlisted at startup. No hidden Western-model fallback is permitted.
- Extraction uses a strict, template-derived JSON Schema. The merge layer checks field IDs, exact source quotes, inference policy, ownership, version, and conflicts.
- Completeness counts only confirmed required fields. Inferences and conflicts are shown separately.
- Telegram uses escaped HTML, compact overview/section cards, contextual inline navigation, and editable stage status messages.
- UI text has RU/EN parity. User facts remain in their original language.
- Multiple briefs can be created and selected explicitly. Templates are versioned snapshots, so template edits preserve saved answers.

The technical audit and measured baseline are in [docs/production-review.md](docs/production-review.md).

## Local setup

Requirements: Node.js 22–25, Docker, an Alibaba Cloud Model Studio workspace/API key, and a Telegram bot token.

1. Copy `.env.example` to `.env`.
2. Fill `TELEGRAM_BOT_TOKEN`, `DASHSCOPE_API_KEY`, `DASHSCOPE_COMPATIBLE_BASE_URL`, `STT_API_KEY`, and `STT_BASE_URL`. Region and key must match.
3. Start dependencies: `docker compose up -d postgres opencode`.
4. Install: `npm ci`.
5. Migrate: `npm run db:migrate`.
6. Verify: `npm test && npm run typecheck && npm run lint && npm run build`.
7. Run: `npm run dev`.

The Model Studio compatible URL looks like `https://WORKSPACE_ID.eu-central-1.maas.aliyuncs.com/compatible-mode/v1` for Frankfurt or the corresponding regional endpoint. Keep the app, Model Studio workspace, and data-residency policy in the same intended region.

## Telegram commands

- `/brief`, `/progress`, `/briefs`, `/new`, `/finish`, `/language`
- `/template_copy Name` — copy the active versioned template.
- `/template_field field.id required|optional|off [order]` — change requiredness, visibility, or ordering while preserving answers.
- `/delete` — two-step deletion of the chat's stored data.

The main menu contains overview, gaps, brief selection, export, language, and rare actions. Internal UUIDs never appear in visible text or exported filenames.

## Operations

- `GET /health` — process liveness.
- `GET /ready` — PostgreSQL readiness.
- `GET /metrics` — Prometheus text metrics.
- `GET /metrics.json` — p50/p95 stage snapshot for a single process.
- Audio retention is controlled by `AUDIO_RETENTION_DAYS`; expired `.ogg` files are removed at startup.
- Production logs contain request/update/brief IDs, stage, error code, model, and latency metadata, but not full text, transcript, audio, credentials, or Telegram headers.

For a real baseline, leave the bot running with representative traffic and collect `/metrics` plus database stage counts. The repository cannot manufacture p50/p95 or quality claims without provider credentials and real traffic.

## Safe rollback

1. Stop bot workers so no new update is accepted.
2. Back up PostgreSQL and `AUDIO_STORAGE_DIR`.
3. Deploy the previous application image.
4. Restore the pre-migration database backup. Migration `0001_production_pipeline.sql` preserves legacy briefs/messages, but enum and column changes are not automatically reversible.
5. Restore the prior environment only if it passes the model-origin policy; `whisper-1` and invented model IDs must not be reintroduced.

Never roll the schema back in place after production messages have been written. Restore the backup into a new database and switch `DATABASE_URL` after verification.
