# 19.7 Streaming event bridge to frontend

## Goal

Expose Brilliant job progress to the browser through SSE. This subtask does not implement reader controls or Codex prompt validation.

## Files likely owned

- `src/server/translation/events.ts`
- route file implementing `GET /api/translation-jobs/:job_id/events`, following existing `src/routes/api/` conventions
- `tests/server/translation/events.test.ts`
- `tests/server/routes/api-translation-events.test.ts`

## Contract references

- `contracts/04-api-and-sse.md`

## SSE contract

Endpoint:

```http
GET /api/translation-jobs/:job_id/events
```

Rules:

- Response content type is `text/event-stream`.
- Event ids are monotonic decimal strings padded to 12 digits per job.
- Event name equals `TranslationEventEnvelope.type`.
- Event data is the JSON envelope.
- Send heartbeat comments every 15 seconds while active.
- Close stream after `translation.job.completed`, `translation.job.failed`, or `translation.job.canceled`.
- Disconnecting the SSE client does not cancel the backend job.

## Reconnect contract

The MVP does not require a durable event replay table. On reconnect, send `translation.job.snapshot` using current SQLite job/chunk state before new events.

`Last-Event-ID` may be supported later if an in-memory or SQLite event buffer is added.

The frontend must be able to combine `GET /api/translation-jobs/:job_id` and SSE to recover after refresh.

Snapshot payload:

- `translation.job.snapshot` uses the same payload shape as `GET /api/translation-jobs/:job_id`.
- The payload includes `job_id`, `memory_id`, `lang_code`, `status`, `source_hash`, `chunk_count`, `completed_chunks`, `failed_chunks`, `retrying_chunks`, `output_path`, and `error`.

## Event mapping contract

Map backend and Codex events to:

- `translation.job.started`
- `translation.chunk.queued`
- `translation.chunk.started`
- `translation.codex.delta`
- `translation.codex.item.started`
- `translation.codex.item.completed`
- `translation.chunk.validating`
- `translation.chunk.completed`
- `translation.chunk.failed`
- `translation.chunk.retrying`
- `translation.job.snapshot`
- `translation.job.stitching`
- `translation.job.committing`
- `translation.job.completed`
- `translation.job.failed`
- `translation.job.canceled`

## Tests

Cover:

- SSE envelope formatting
- monotonic event ids
- heartbeat output
- terminal events close the stream
- reconnect emits `translation.job.snapshot` before new events
- snapshot payload matches job status API payload
- Codex delta events are marked non-authoritative
- stream disconnect does not cancel job

## Verification

```sh
mise exec -- bun run test tests/server/translation/events.test.ts
mise exec -- bun run test tests/server/routes/api-translation-events.test.ts
mise exec -- bun run typecheck
```

## Acceptance criteria

- Frontend can stream progress without WebSocket.
- Partial deltas are never treated as persisted translation.
- Event payloads are stable enough for 19.12 UI work.
- Reconnect behaviour is deterministic without requiring an event replay table.
