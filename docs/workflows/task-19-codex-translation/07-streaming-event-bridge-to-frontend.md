# 19.7 Streaming event bridge to frontend

## Goal

Expose Brilliant job progress to the browser through SSE. This subtask does not implement reader controls or Codex prompt validation.

## Files likely owned

- `src/server/translation/events.ts`
- `src/routes/api/translation-jobs/[jobId]/events.ts`
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

If an event replay buffer exists, support `Last-Event-ID`. If not, send a current-state snapshot event before new events after reconnect.

The frontend must be able to combine `GET /api/translation-jobs/:job_id` and SSE to recover after refresh.

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
- reconnect with `Last-Event-ID` when replay buffer exists, or current-state snapshot fallback
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
