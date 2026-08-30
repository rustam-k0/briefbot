# BriefBot production review — 2026-08-30

## Baseline and evidence

The repository contained an uncommitted MVP, an empty local PostgreSQL database, and no production traces or saved audio. Therefore historical p50/p95, provider success rate, cost, and the reported 1:30 voice failure cannot be measured from available evidence. Before changes, 16 unit tests passed in 0.72 s (test body 52 ms); typecheck took 2.41 s and lint 1.32 s. These are build timings, not production latency.

| Problem | Evidence in the MVP | Root cause | Impact | Fix | Priority |
|---|---|---|---|---|---|
| First voice attempt disappears | `bot.ts` saved a message only after `stt.transcribe()` | No ingestion record or durable audio before ASR | Lost recovery context; retransmission required | Persist update/file ID first, secure durable file, stage state, retry from failure | P0 |
| Opaque voice error | One catch returned “Не удалось обработать” | Download, ASR, extraction and save shared one exception boundary | User cannot act; operators cannot localize failure | Separate stages/error codes and stage-specific retry text | P0 |
| 0→100 completeness | `meaningful()` counted inferred/unknown/declined and nine unweighted topic groups | Model-adjacent state used as business readiness | False completion | Weighted template calculation; only confirmed required fields count | P0 |
| Raw Markdown and UUID | `renderFinalMarkdown()` emitted `#`, `**`, `_status_`, `brief.id`; replies had no parse mode | Markdown file renderer reused as Telegram renderer | Broken UX and leaked implementation details | Dedicated escaped HTML cards; file-only Markdown; friendly titles | P0 |
| Duplicate update cannot resume | `processed_updates` was marked before model call | Boolean idempotency without stage machine | Retry was suppressed after partial failure | One message row per update with stages, attempts and recovery | P0 |
| Cross-message race | An in-memory queue was keyed only by chat | No cross-instance ordering; active brief read happened before lock | Lost update/optimistic conflicts | Per-context queue plus PostgreSQL advisory lock and row lock | P0 |
| Ambiguous brief context | Unique “one active brief per chat” and implicit latest object | No explicit selected brief | Messages can affect the wrong document | `chats.active_brief_id`, ownership checks, My briefs selector, visible title | P0 |
| Invalid model policy | `.env.example`/Render used `whisper-1`; Render named `qwen3.8-flash` through an unverified route | No origin/ID allowlist | Violates provider requirement and may fail at runtime | Alibaba-only provider config and startup allowlists | P0 |
| Silent long work | No immediate status or chat action | Handler waited for network calls | Perceived hang and webhook retries | Immediate status, stage edits, async webhook acknowledgement | P0 |
| No language parity | UI strings lived in Russian handlers | No localization boundary | English unusable | RU/EN catalog, parity test, saved locale | P1 |
| Fixed design schema | Hard-coded field paths and progress groups | No versioned template | Cannot support other briefs safely | Versioned JSON template, snapshots, copy/edit commands | P1 |
| No operational baseline | No metrics or stage logs | Observability absent | Performance regressions invisible | `/metrics`, `/metrics.json`, stage/model metadata | P1 |

## Data path after the change

`Telegram update → immediate acknowledgement/status → transactional identity + selected brief + session → immutable message ingestion → secure audio download (voice only) → Qwen ASR → strict Qwen JSON extraction → application validation → deterministic merge/history → completeness → compact localized response`.

The webhook returns HTTP 200 after dispatching the update, rather than waiting for AI completion. Update/message uniqueness prevents a Telegram redelivery from applying facts twice. The database message stage remains the recovery source after restart.

## Storage model

- `telegram_users`: Telegram identity and UI locale.
- `chats`: owner and explicit `active_brief_id`.
- `briefs`: friendly title/short code, template key/version/snapshot, JSON aggregate, optimistic version.
- `brief_sessions`: 30-minute activity window and provider session ID. A long pause starts a new session but does not silently switch the selected brief.
- `messages`: Telegram update/message/file IDs, user/chat/brief/session, source, raw text, durable file path, transcript, language, stage, failure, attempts, extraction, apply result, and model metadata.
- `brief_field_values`: current normalized values.
- `brief_field_history`: append-only before/after provenance for every accepted change.
- `brief_templates`: built-in or owner-scoped versioned definitions.
- `brief_snapshots`: immutable final template + answers + source message IDs + export.

Ownership is checked by joining the requested brief to the Telegram chat. Callback UUIDs are transport-only and never rendered to the user.

## Completeness

`percent = confirmed weight of applicable required fields / total weight of applicable required fields × 100`.

`inferred`, `missing`, and `conflicting` contribute zero. `not_applicable` is removed from the denominator. Optional `skipped` fields never block completion. The UI also shows confirmed/required counts, inferences needing confirmation, and conflicts.

## Model routing

Only Alibaba/Qwen models are configured. Model IDs and capabilities were checked against Alibaba Cloud's [text model table](https://www.alibabacloud.com/help/en/model-studio/text-generation-model), [structured output documentation](https://www.alibabacloud.com/help/en/model-studio/qwen-structured-output), and [Qwen ASR API](https://www.alibabacloud.com/help/en/model-studio/qwen-asr-api-reference).

| Task | Primary | Fallback | Reason |
|---|---|---|---|
| Language classification | deterministic Unicode/application code | none | No model call needed |
| Speech recognition | `qwen3-asr-flash` | `qwen-audio-3.0-asr-flash` | Official audio-capable Alibaba ASR IDs; OGG is sent as a base64 data URL |
| Transcript normalization | ASR inverse text normalization | original transcript | No second LLM call |
| Fact extraction + question proposal | `qwen3.8-flash` | `qwen3.7-plus` | 1M context and strict structured output; Flash minimizes normal-path cost/latency |
| Field mapping/validation | application JSON Schema | none | Deterministic and testable |
| Conflict detection/merge | application code | none | Model cannot overwrite persisted state |
| Summary/final formatting | application code | none | Avoids cost and invented facts |
| Translation | disabled | none | Original facts are preserved; UI is localized separately |

Alibaba documents a 1M context and structured output for both text models. Current global default rate limits shown by Alibaba are 30,000 RPM / 5,000,000 TPM for `qwen3.8-flash` and `qwen3.7-plus`; actual workspace quotas must be checked in the console ([rate limits](https://www.alibabacloud.com/help/en/model-studio/rate-limit)). `qwen3.7-plus` list pricing in Singapore begins at $0.40/M input and $1.60/M output tokens for inputs up to 256K; pricing is read at deployment time because it changes ([official model page](https://www.alibabacloud.com/help/en/model-studio/qwen3-7-plus)). ASR list price is $0.000035 per audio second in Singapore ([official pricing](https://www.alibabacloud.com/help/en/model-studio/model-pricing)).

No live model benchmark was run because no valid Alibaba API credential was available to the review. Claiming accuracy, latency, or cost would be false. `npm run benchmark` is a reproducible synthetic RU/EN fixture runner for an authorized environment. The deployment gate is schema-valid rate ≥99%, field precision ≥98%, and p95 extraction latency ≤8 s on at least 100 representative, de-identified messages; ASR must be measured separately on consented audio.

For privacy, use a Model Studio region matching residency requirements. Alibaba states region determines static data location, transient inference is encrypted, and an EU-scoped Frankfurt deployment is available ([regions](https://www.alibabacloud.com/help/en/model-studio/regions/)). Alibaba also states submitted data is not used for model training and is encrypted with AES-256 ([privacy FAQ](https://www.alibabacloud.com/help/en/model-studio/faq-about-alibaba-cloud-model-studio)). Contractual retention still requires owner/legal review.

## UX map

| Russian | English | Purpose |
|---|---|---|
| Выбор языка | Language choice | First start and `/language` |
| Обзор брифа | Brief overview | Title, completeness, confirmed/inferred/missing |
| Раздел 1/N | Section 1/N | Previous/next and gaps-only navigation |
| Мои брифы | My briefs | Explicit active brief selection |
| Получил → Расшифровываю → Извлекаю → Сохраняю | Received → Transcribing → Extracting → Saving | One edited status message |
| Повторить | Retry | Resume from stored file/transcript/message |
| Подтвердить и экспортировать | Confirm and export | Immutable Markdown snapshot |

## Verification result

- 23 domain/application/security/UX tests pass.
- 4 Qwen ASR protocol/fallback/circuit-breaker/concurrency tests pass.
- 5 PostgreSQL integration tests pass against PostgreSQL 17, including concurrent ingestion, deduplication, voice pre-ingestion, ownership isolation, and normalized history (32 total).
- TypeScript typecheck, ESLint, production build, and migration smoke test pass.
- The database migration created all nine production tables and the six-value field status enum.
- Dependency audit reports zero known vulnerabilities.

Real provider and Telegram end-to-end checks remain environment gates because the workspace contains no valid Telegram token, Alibaba key, production audio, or consented traffic. Required final smoke: RU text, EN text, 90-second OGG/Opus, forced extraction failure after successful ASR, retry without a second ASR call, two briefs, language switch, HTML special characters, long export, restart recovery, primary/fallback outage.

## Remaining risks

1. The in-process `/metrics` histogram resets at restart; production should scrape it and aggregate externally.
2. Audio is stored on the configured filesystem. Multi-instance production needs an encrypted shared object store and lifecycle policy; a local Render filesystem without a persistent disk is not sufficient.
3. Recovery automatically retries saved text/transcripts three times. A voice that failed before download needs the user's Retry button so Telegram file download can be reattempted.
4. Custom template commands expose field IDs; a non-technical visual template editor remains a product enhancement.
5. The migration was verified with a synthetic legacy brief and preserves its fields, raw message, selection, and completed state. A production backup and restore rehearsal are still mandatory before applying any irreversible enum/column migration.
