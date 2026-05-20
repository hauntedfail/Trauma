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
  "output_path": "memory/018f.../ja-JP/CONTENT.md"
}
```

Status codes:

- `202` for newly started async job
- `200` for current committed translation or already running job reuse
- `400` for invalid language code
- `404` for missing memory or source content
- `409` for missing configured target language, request/setting language mismatch, Codex auth/setup required, stale running conflict, or cancellation conflict
- `500` for unexpected server failure

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
  "output_path": "memory/018f.../ja-JP/CONTENT.md",
  "completed_at": "2026-05-20T00:00:00.000Z"
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
  "error": null
}
```

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

Rules:

- Event ids are monotonic decimal strings padded to 12 digits per job.
- Support `Last-Event-ID` if an in-memory or SQLite event buffer is implemented.
- If no replay buffer exists in MVP, reconnect returns current job state first, then new events.
- Send heartbeat comments every 15 seconds while the job is active.
- Stream closes after completed, failed, or canceled terminal events.
- Stream disconnect does not cancel the backend job.

## Cancel job

```http
POST /api/translation-jobs/:job_id/cancel
```

```json
{
  "job_id": "018f...",
  "status": "cancel_requested"
}
```
