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
- `contracts/06-codex-prompt-and-validation.md`

## Instruction alignment

Scope: Reader backend SSE progress stream and mapping from backend/Codex events to frontend events.

Inputs: translation job state, chunk progress, Codex app-server notifications, and terminal job metadata.

Outputs: `text/event-stream` route, stable event envelope, reconnect snapshot, and completion payload with `reader_url`.

Dependencies: 19.3 defines job state, 19.5 defines app-server event types, and 19.10 defines final output metadata.

Parallelization notes: can run beside frontend progress UI after event envelope is frozen; do not persist streamed deltas as completed output.

Implementation risks: treating partial deltas as authoritative or omitting reconnect snapshots breaks the instruction's streaming and persistence boundaries.

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
- Close stream after `translation.job.completed`, `translation.job.failed`, `translation.job.stale`, or `translation.job.canceled`.
- Disconnecting the SSE client does not cancel the backend job.

## Reconnect contract

The MVP does not require a durable event replay table. On reconnect, send `translation.job.snapshot` using current SQLite job/chunk state before new events.

`Last-Event-ID` may be supported later if an in-memory or SQLite event buffer is added.

The frontend must be able to combine `GET /api/translation-jobs/:job_id` and SSE to recover after refresh.

Snapshot payload:

- `translation.job.snapshot` uses the same payload shape as `GET /api/translation-jobs/:job_id`.
- The payload includes `job_id`, `memory_id`, `lang_code`, `status`, `source_hash`, `chunk_count`, `completed_chunks`, `failed_chunks`, `retrying_chunks`, `output_path`, `reader_url`, and `error`.
- `completed_chunks` follows the public aggregation rule from the API contract: chunks with status `complete` or `purged` count as completed.

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
- `translation.job.stale`
- `translation.job.canceled`

Typed Codex app-server event mapping:

- `thread.started` is internal orchestration state unless debugging output is enabled.
- `turn.started` stores `threadId` and `turnId` for cancellation.
- `item.started` maps to `translation.codex.item.started`.
- `item.agentMessage.delta` maps to `translation.codex.delta`.
- `item.completed` maps to `translation.codex.item.completed`.
- `turn.completed` with successful final output is followed by validation events, not immediate persistence.
- `turn.completed` with interrupted status maps to cancellation flow.

Raw app-server notification names such as `item/agentMessage/delta` are parsed only by `src/server/translation/codex-app-server.ts`. This subtask consumes typed internal events only.

Completed event payload includes `output_path`, `output_hash`, and `reader_url`.
Failed event payloads include `error` with the same `code`, `message`, and optional `action` shape as `TranslationJobSnapshotError`. Chunk failure payloads also include `retry_count` and `will_retry`.
Stale event payload includes `reason`, `job_source_hash`, and `current_source_hash`.

`unavailable` is snapshot-only. Do not add `translation.job.unavailable` as an
SSE event in the MVP. If an SSE reconnect snapshot or job status payload has
`status = "unavailable"`, the frontend renders the `translation_unavailable`
recovery UI and does not wait for another terminal event.

## Tests

Cover:

- SSE envelope formatting
- monotonic event ids
- heartbeat output
- terminal events close the stream
- `translation.job.stale` is terminal and closes the stream
- unavailable status is handled through snapshot/job-status payloads, not a dedicated SSE event
- reconnect emits `translation.job.snapshot` before new events
- snapshot payload matches job status API payload
- snapshot `completed_chunks` still includes purged chunks after final commit
- completed event includes `reader_url`
- job failed event includes a safe `error` object with stable `code`
- chunk failed event includes safe `error`, `retry_count`, and `will_retry`
- app-server item notifications map to Reader events
- streaming bridge consumes typed Codex events rather than raw app-server method names
- `turn.started` stores cancellation ids without exposing app-server connection details
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
