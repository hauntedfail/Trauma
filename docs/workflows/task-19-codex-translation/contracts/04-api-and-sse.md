# Brilliant API and SSE contract

## Start or reuse translation

```http
POST /api/memories/:memory_id/translations
content-type: application/json

{
  "lang_code": "ja-JP"
}
```

For the MVP frontend, the request body may be `{}`. The backend reads `translation_target_lang_code` from SQLite and uses that value. If `lang_code` is present, it is a consistency assertion, not the canonical source.

New job response:

```json
{
  "status": "started",
  "job_id": "018f...",
  "memory_id": "018f...",
  "lang_code": "ja-JP",
  "source_hash": "sha256:...",
  "event_url": "/api/translation-jobs/018f.../events"
}
```

Current translation response:

```json
{
  "status": "current",
  "job_id": "018f...",
  "memory_id": "018f...",
  "lang_code": "ja-JP",
  "source_hash": "sha256:...",
  "output_path": "memories/018f.../ja-JP/CONTENT.md",
  "reader_url": "/memories/ja-JP/018f..."
}
```

Active job reuse response:

```json
{
  "status": "active",
  "job_status": "pending",
  "job_id": "018f...",
  "memory_id": "018f...",
  "lang_code": "ja-JP",
  "source_hash": "sha256:...",
  "event_url": "/api/translation-jobs/018f.../events"
}
```

Status codes:

- `202` for newly started async job
- `200` for current committed translation or already running job reuse
- `400` for invalid language code
- `404` for missing memory or source content
- `409` for missing configured target language, request/setting language mismatch, Codex auth/setup required, stale running conflict, or cancellation conflict
- `502` for invalid final Codex/model output
- `503` for configured but unavailable Codex app-server
- `504` for Codex timeout
- `500` for unexpected server failure

Error response shape:

```json
{
  "status": "error",
  "code": "translation_language_required",
  "message": "Translation target language is not configured.",
  "action": "open_settings"
}
```

Rules:

- `code` is the stable frontend branch key.
- `message` is safe for display and must not include source chunks, prompts,
  credential paths, tokens, app-server URLs, or raw app-server payloads.
- `action` is optional and uses one of `open_settings`, `setup_codex_auth`,
  `retry`, `open_source_reader`, `start_fresh_translation`, or `none`.

Active reuse rules:

- `POST /api/memories/:memory_id/translations` returns `200` with `status = "active"` and the actual `job_status` for reused jobs in `pending`, `running`, `stitching`, or `committing`.
- The response must not collapse reused `pending`, `stitching`, or `committing` jobs into `status = "running"`.
- A reused active response always includes `event_url`; the frontend then reads `GET /api/translation-jobs/:job_id` or the first SSE `translation.job.snapshot` for exact progress state.
- A `cancel_requested` job remains covered by the active unique index until cancellation reaches `canceled`, but start/reuse does not return it as an active translation. Return `409` with `code = "cancellation_conflict"` and `action = "none"` so the user can retry after cancellation completes.

Required error codes:

- `translation_language_required`
- `translation_language_mismatch`
- `invalid_language`
- `missing_memory`
- `missing_source_content`
- `auth_required`
- `setup_required`
- `app_server_unavailable`
- `translation_unavailable`
- `stale_source`
- `cancellation_conflict`
- `usage_limit`
- `context_overflow`
- `timeout`
- `stream_disconnected`
- `invalid_final_output`
- `validation_failed`
- `filesystem_failure`
- `unknown`

HTTP mapping:

- `translation_language_required`: `409`
- `translation_language_mismatch`: `409`
- `invalid_language`: `400`
- `missing_memory`: `404`
- `missing_source_content`: `404`
- `auth_required`: `409`
- `setup_required`: `409`
- `app_server_unavailable`: `503`
- `translation_unavailable`: `409`
- `stale_source`: `409`
- `cancellation_conflict`: `409`
- `usage_limit`: `409`
- `context_overflow`: `409`
- `timeout`: `504`
- `stream_disconnected`: `503`
- `invalid_final_output`: `502`
- `validation_failed`: `409`
- `filesystem_failure`: `500`
- `unknown`: `500`

## Read committed translation metadata

```http
GET /api/memories/:memory_id/translations/:lang_code
```

```json
{
  "memory_id": "018f...",
  "lang_code": "ja-JP",
  "status": "current",
  "source_hash": "sha256:...",
  "output_hash": "sha256:...",
  "output_path": "memories/018f.../ja-JP/CONTENT.md",
  "reader_url": "/memories/ja-JP/018f...",
  "completed_at": "2026-05-20T00:00:00.000Z"
}
```

Rules:

- This endpoint returns only current committed translation metadata.
- It must use `resolveCurrentTranslationReadOnly()` from `src/server/translation/current-translation.ts`.
- If no complete translation exists for the current source hash, return the project-standard not-found response.
- If a complete row exists but the output file is missing or hash-mismatched, call `repairUnavailableTranslation()` to mark the row `unavailable` and return `409` with `code = "translation_unavailable"`.
- Clients recover from `translation_unavailable` by navigating to the source reader route `/memories/:id` and starting a fresh translation through `POST /api/memories/:memory_id/translations`; do not retry this metadata endpoint as the recovery action.
- It must not silently return metadata for stale, unavailable, missing, or hash-mismatched output.

`translation.job.snapshot` uses the same payload shape as `GET /api/translation-jobs/:job_id`.

`reader_url` is derived, not stored. It is non-null only when a current committed translation exists for `(memory_id, lang_code, source_hash)` and the output file hash matches the completed translation row. For pending, running, cancel-requested, canceled, failed, stale, or renderable-output-missing states, `reader_url` is `null`.

For historical completed jobs whose `source_hash` no longer matches the current
source `CONTENT.md` hash, `GET /api/translation-jobs/:job_id` returns
`reader_url: null` even if the old translated file still exists. For complete
jobs whose output file is missing or hash-mismatched, the job status API may
call `repairUnavailableTranslation()`, mark the job `unavailable`, and return
`reader_url: null`.

Unavailable job status response:

```json
{
  "job_id": "018f...",
  "memory_id": "018f...",
  "lang_code": "ja-JP",
  "status": "unavailable",
  "source_hash": "sha256:...",
  "chunk_count": 42,
  "completed_chunks": 42,
  "failed_chunks": 0,
  "retrying_chunks": 0,
  "output_path": null,
  "reader_url": null,
  "error": {
    "code": "translation_unavailable",
    "message": "The translated output is no longer available. Start a new translation.",
    "action": "start_fresh_translation"
  }
}
```

## Read job status

```http
GET /api/translation-jobs/:job_id
```

```json
{
  "job_id": "018f...",
  "memory_id": "018f...",
  "lang_code": "ja-JP",
  "status": "running",
  "source_hash": "sha256:...",
  "chunk_count": 42,
  "completed_chunks": 13,
  "failed_chunks": 0,
  "retrying_chunks": 1,
  "output_path": null,
  "reader_url": null,
  "error": null
}
```

`completed_chunks` in this response counts chunks with status `complete` or
`purged`, so a successfully committed-and-purged job still reports all chunks as
completed.

## Stream job events

```http
GET /api/translation-jobs/:job_id/events
accept: text/event-stream
```

SSE message:

```text
id: 000000000013
event: translation.chunk.completed
data: {"id":"000000000013","type":"translation.chunk.completed","job_id":"018f...","memory_id":"018f...","lang_code":"ja-JP","chunk_index":3,"timestamp":1710000000000,"data":{"translated_hash":"sha256:..."}}
```

Completed event data:

```json
{
  "output_path": "memories/018f.../ja-JP/CONTENT.md",
  "output_hash": "sha256:...",
  "reader_url": "/memories/ja-JP/018f..."
}
```

Job failed event data:

```json
{
  "error": {
    "code": "timeout",
    "message": "The Codex turn timed out.",
    "action": "retry"
  }
}
```

Chunk failed event data:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Translated chunk failed validation.",
    "action": "retry"
  },
  "retry_count": 1,
  "will_retry": true
}
```

Failure event error objects use the same `code`, `message`, and optional
`action` contract as `TranslationJobSnapshotError`. Chunk failure events derive
their `error` object from the structured `translation_chunks.error` JSON when it
exists; otherwise they synthesize a safe structured error before emitting.

Stale event data:

```json
{
  "reason": "source_changed",
  "job_source_hash": "sha256:...",
  "current_source_hash": "sha256:..."
}
```

Rules:

- Event ids are monotonic decimal strings padded to 12 digits per job.
- MVP does not require a durable event replay table.
- On reconnect, emit `translation.job.snapshot` first using current SQLite job/chunk state, then stream new events.
- `Last-Event-ID` support may be added later if an in-memory or SQLite event buffer is implemented.
- Send heartbeat comments every 15 seconds while the job is active.
- Stream closes after completed, failed, stale, or canceled terminal events.
- Stream disconnect does not cancel the backend job.
- Frontend completion navigation uses `translation.job.completed.data.reader_url`; it must not reconstruct a different route shape.
- Frontend failure rendering uses failure event `data.error.code` as the stable branch key, not free-form `message`.

## Cancel job

```http
POST /api/translation-jobs/:job_id/cancel
```

Cancelable statuses:

- `pending` and `running` transition to `cancel_requested`.
- `cancel_requested` and `canceled` are idempotent success responses.
- `stitching`, `committing`, `complete`, `stale`, `failed`, and `unavailable`
  return `409` with `code = "cancellation_conflict"`.

Pending/running response:

```json
{
  "job_id": "018f...",
  "status": "cancel_requested"
}
```

Already-canceled idempotent response:

```json
{
  "job_id": "018f...",
  "status": "canceled"
}
```

Conflict response:

```json
{
  "status": "error",
  "code": "cancellation_conflict",
  "message": "This translation job can no longer be canceled.",
  "action": "none"
}
```
