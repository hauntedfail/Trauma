# 19.7 Streaming event bridge to frontend

## Goal

Bridge Reader backend job events and Codex app-server notifications to frontend SSE progress events.

## Scope

Implement the event envelope, event id sequence, SSE endpoint, heartbeat, reconnect behavior, event broadcaster, and mapping from app-server notifications to Reader event types.

## Inputs

- `docs/workflows/task-19-codex-translation/00-execution-contracts.md`
- 19.3 job state events
- 19.5 app-server notification adapter

## Outputs

- Create: `src/server/translation/events.ts`
- Create: `src/routes/api/translation-jobs/[jobId]/events.ts`
- Test: `tests/server/translation/events.test.ts`
- Test: `tests/server/routes/api-translation-events.test.ts`

## Dependencies

- 19.3 for state event names.
- 19.5 for Codex notification names.

## Concrete SSE behavior

- `GET /api/translation-jobs/:job_id/events` returns `text/event-stream`.
- Each message uses `id`, `event`, and JSON `data` fields as defined in `00-execution-contracts.md`.
- Event ids are monotonic decimal strings padded to 12 digits per job.
- Send heartbeat comments every 15 seconds while active.
- If `Last-Event-ID` replay buffer is available, replay missed events.
- If no replay buffer exists in MVP, emit a current-state snapshot event before new events.
- Close stream after `translation.job.completed`, `translation.job.failed`, or `translation.job.canceled`.

## Acceptance criteria

- All required event types are emitted through the shared envelope.
- `translation.codex.delta` is explicitly non-authoritative.
- Authoritative chunk completion is emitted only after parsing and validation.
- Reconnecting clients can recover current state through job status plus stream continuation.
- Stream disconnect does not cancel the backend job.
- Raw deltas are not persisted as completed translation.

## Parallelization notes

Can run with 19.5 after event names are frozen. 19.12 must wait for this envelope.

## Implementation risks

- Event ordering bugs can show completed state before purge.
- No heartbeat can make long jobs look stalled.
- Persisting every delta bloats SQLite and violates the storage boundary.
