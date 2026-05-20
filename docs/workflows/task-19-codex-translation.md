# Brilliant: Codex app-server translation for memories

## Status

- State: Planning only; ready for implementation after this workflow is accepted.
- Base branch: `main`
- Implementation branch: `feat/brilliant`
- Depends on: Task 18 settings page, BCP 47 target-language setting, and OpenAI/Codex auth status surface.
- Scope: Add a Codex-powered translation pipeline for Reader memory content, including app-server integration, Reader-owned chunk orchestration, streaming progress, validation, retry, atomic translated `CONTENT.md` persistence, and SQLite cleanup.
- Out of scope: multi-user auth, hosted OAuth service, direct browser access to Codex app-server, direct OpenAI Responses API integration, non-Codex providers, collaborative translation editing, and storing completed translated article bodies in SQLite.

## Instruction basis

This plan is rebuilt from `TASK_19_INSTRUCTION.md` and supersedes the earlier `codex exec`-first design. The preferred integration surface is Codex app-server because it supports application integration, thread/turn control, managed ChatGPT sign-in flows, and streamed agent events. The Reader backend remains the owner of memory storage, chunking, validation, retry, final file writes, SQLite cleanup, and frontend event streaming.

Research reference captured by the instruction:

- [App Server - Codex | OpenAI Developers](https://developers.openai.com/codex/app-server)

## Core architecture decisions

- Use Codex app-server as the production integration path.
- Use Codex managed ChatGPT sign-in; surface app-server `chatgptDeviceCode` login when auth is missing.
- Keep OpenAI/ChatGPT tokens out of TRAUMA SQLite, logs, frontend responses, and browser storage.
- Do not expose Codex app-server directly to the browser; only the Reader backend talks to Codex.
- Use one ephemeral Codex thread per chunk by default so long documents do not depend on one long model context.
- Keep document-level state, glossary, style profile, chunk manifest, retries, and stitching in Reader code and SQLite.
- Use SSE as the default frontend transport because the MVP only needs server-to-client progress streaming.
- Add cancellation through a normal backend endpoint and job state; defer WebSocket until bidirectional live steering is required.
- Store source memory content at `memory/<memory_id>/CONTENT.md`.
- Store translated content at `memory/<memory_id>/<lang_code>/CONTENT.md`, for example `memory/abc123/ja-JP/CONTENT.md`.
- Use BCP 47 language codes such as `ja-JP`.
- Do not introduce persistent `.work/<job_id>` artifacts.
- Allow temporary SQLite chunk content during translation only.
- Immediately purge completed translated chunk bodies from SQLite after final `CONTENT.md` has been atomically committed.
- Persist only metadata needed for status, stale detection, audit, retry diagnostics, and cache validation.

## End-to-end pipeline

1. Source loading reads `memory/<memory_id>/CONTENT.md`, computes `source_hash`, file size, rough token estimate, document type hint, source URL, and source title.
2. Block manifest generation parses Markdown into deterministic blocks with stable ids such as `b000001`.
3. Chunking groups contiguous blocks, prefers section boundaries, splits oversized sections by block groups, and preserves document order.
4. Codex translation sends one chunk plus metadata and policy to Codex app-server `turn/start` with an output schema.
5. Streaming maps Codex notifications such as `item/agentMessage/delta`, `item/started`, and `item/completed` into Reader SSE events.
6. Validation checks every completed chunk before it can become authoritative.
7. Retry handles chunk-level validation, auth, usage, timeout, context, and stream failures without retrying the whole document unnecessarily.
8. Stitching reassembles translated blocks in manifest order and performs final full-document validation.
9. Atomic commit writes a same-directory temp file, flushes it, renames it to `CONTENT.md`, flushes the parent directory when supported, marks the job complete, and purges completed chunk bodies.
10. Reader rendering reloads `memory/<memory_id>/<lang_code>/CONTENT.md` only after commit succeeds.

## Minimal SQLite schema direction

Brilliant should add these tables or equivalent Drizzle schema objects:

```sql
translation_jobs
translation_chunks
```

`translation_jobs` tracks job metadata, status, hashes, output path, model, chunker version, skill version, errors, and timestamps.

`translation_chunks` tracks per-chunk source hash, ordered block ids, status, retry count, temporary translated Markdown, translated hash, error state, and timestamps.

Status values must be explicit. At minimum: `pending`, `running`, `validating`, `failed`, `complete`, and `purged`.

Completed chunk body cleanup is required:

```sql
UPDATE translation_chunks
SET translated_markdown = NULL,
    status = 'purged'
WHERE job_id = ?
  AND status = 'complete';
```

## Reader streaming event contract

Use SSE at:

```http
GET /api/translation-jobs/:job_id/events
```

Use this event envelope:

```json
{
  "type": "translation.codex.delta",
  "job_id": "...",
  "memory_id": "...",
  "lang_code": "ja-JP",
  "chunk_index": 3,
  "timestamp": 1710000000000,
  "data": { "text": "..." }
}
```

Required event types:

```text
translation.job.started
translation.chunk.queued
translation.chunk.started
translation.codex.delta
translation.codex.item.started
translation.codex.item.completed
translation.chunk.validating
translation.chunk.completed
translation.chunk.failed
translation.chunk.retrying
translation.job.stitching
translation.job.committing
translation.job.completed
translation.job.failed
```

Partial Codex deltas are non-authoritative progress only. Persistence must use final completed, parsed, validated chunk output.

## Minimal backend API shape

```http
POST /api/memories/:memory_id/translations
GET  /api/memories/:memory_id/translations/:lang_code
GET  /api/translation-jobs/:job_id
GET  /api/translation-jobs/:job_id/events
POST /api/translation-jobs/:job_id/cancel
```

`POST /api/memories/:memory_id/translations` starts or reuses a translation job for the requested `lang_code`.

`GET /api/memories/:memory_id/translations/:lang_code` returns committed translation metadata and renderability state.

`GET /api/translation-jobs/:job_id` returns current job state from SQLite.

`GET /api/translation-jobs/:job_id/events` streams SSE progress.

`POST /api/translation-jobs/:job_id/cancel` requests cancellation by marking backend job state; WebSocket is not required for MVP cancellation.

## Subtask execution order

1. [19.1 Requirements and architecture finalization](task-19-codex-translation/01-requirements-and-architecture-finalization.md)
2. [19.2 SQLite schema and migration design](task-19-codex-translation/02-sqlite-schema-and-migration-design.md)
3. [19.3 Translation job state machine](task-19-codex-translation/03-translation-job-state-machine.md)
4. [19.4 Markdown block manifest and chunker](task-19-codex-translation/04-markdown-block-manifest-and-chunker.md)
5. [19.5 Codex app-server integration](task-19-codex-translation/05-codex-app-server-integration.md)
6. [19.6 Codex auth and device-code setup flow](task-19-codex-translation/06-codex-auth-and-device-code-setup-flow.md)
7. [19.7 Streaming event bridge to frontend](task-19-codex-translation/07-streaming-event-bridge-to-frontend.md)
8. [19.8 Chunk translation prompt and output schema](task-19-codex-translation/08-chunk-translation-prompt-and-output-schema.md)
9. [19.9 Chunk validation and retry logic](task-19-codex-translation/09-chunk-validation-and-retry-logic.md)
10. [19.10 Stitching and atomic commit](task-19-codex-translation/10-stitching-and-atomic-commit.md)
11. [19.11 SQLite cleanup and purge policy](task-19-codex-translation/11-sqlite-cleanup-and-purge-policy.md)
12. [19.12 Frontend translation controls and progress UI](task-19-codex-translation/12-frontend-translation-controls-and-progress-ui.md)
13. [19.13 Reader render integration for translated CONTENT.md](task-19-codex-translation/13-reader-render-integration-for-translated-content.md)
14. [19.14 Translation skill definition](task-19-codex-translation/14-translation-skill-definition.md)
15. [19.15 Error handling and cancellation](task-19-codex-translation/15-error-handling-and-cancellation.md)
16. [19.16 Test plan and fixtures](task-19-codex-translation/16-test-plan-and-fixtures.md)
17. [19.17 End-to-end validation with long paper fixture](task-19-codex-translation/17-end-to-end-validation-with-long-paper-fixture.md)

Do not start implementation until the plan is accepted.

## Parallelization map

- Track A: 19.2 and 19.3 after 19.1 freezes schema/status names.
- Track B: 19.4 after 19.1 freezes block id and manifest contracts.
- Track C: 19.5, 19.6, and 19.7 after 19.1 freezes app-server and SSE boundaries.
- Track D: 19.12 and 19.13 after 19.7 freezes the event envelope and 19.10 freezes output metadata.
- Track E: 19.8, 19.9, and 19.14 after 19.4 freezes block ids and protected-span representation.
- Track F: 19.16 and 19.17 after interfaces from 19.2 through 19.10 are stable.

Subagents may work only on non-overlapping files and must report changed files, new interfaces, assumptions, risks, and required follow-up.

## Redefined plan acceptance criteria

- Uses `memory/<memory_id>/<lang_code>/CONTENT.md`.
- Uses `ja-JP`-style BCP 47 language codes.
- Does not introduce `.work/<job_id>`.
- Allows temporary SQLite chunk storage during translation.
- Requires immediate purge of translated chunk bodies after final commit.
- Uses atomic final file write.
- Supports long documents and academic papers through deterministic chunking.
- Includes frontend streaming progress through SSE.
- Uses Codex app-server as the preferred integration path.
- Keeps Codex tokens out of the frontend and TRAUMA SQLite.
- Treats external article content as untrusted data.
- Defines validation and retry at chunk level.
- Defines final stitching and full-document validation.
- Includes repo-local `reader-translate` skill planning.
- Produces numbered subtasks with dependencies and parallelization notes.
- Keeps Brilliant planning-only until implementation is explicitly authorized.
