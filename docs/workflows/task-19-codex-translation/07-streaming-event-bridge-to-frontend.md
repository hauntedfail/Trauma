# 19.7 Streaming event bridge to frontend

## Goal

Bridge Reader backend job events and Codex app-server notifications to frontend SSE progress events.

## Scope

Implement the event envelope, SSE endpoint, job event broadcaster, reconnection behavior, and mapping from Codex notifications to Reader event types.

## Inputs

- 19.1 SSE decision and event list
- 19.3 job state events
- 19.5 app-server notification adapter

## Outputs

- `GET /api/translation-jobs/:job_id/events` returning `text/event-stream`.
- Event envelope with `type`, `job_id`, `memory_id`, `lang_code`, `chunk_index`, `timestamp`, and `data`.
- Event mapping for job lifecycle, chunk lifecycle, Codex deltas, validation, retry, stitching, committing, completion, and failure.

## Dependencies

- 19.1 for transport choice.
- 19.3 for state event names.
- 19.5 for Codex notification names.

## Acceptance criteria

- SSE is the default transport.
- The endpoint does not require WebSocket for MVP progress.
- The event stream emits all required event types from the parent workflow.
- `translation.codex.delta` events are clearly non-authoritative.
- Authoritative chunk completion events are emitted only after final app-server output is parsed and chunk validation passes.
- Reconnecting clients can recover current state from `GET /api/translation-jobs/:job_id` and continue streaming new events.
- The backend does not persist streamed raw deltas as completed translation.
- The stream closes cleanly on job completion, failure, or cancellation.

## Parallelization notes

This can run with 19.5 after event names are frozen. Frontend work in 19.12 should wait until this event envelope is stable.

## Implementation risks

- Event ordering bugs can display completed state before purge and commit actually finish.
- Long-running SSE connections need heartbeat or timeout behavior suited to the local app runtime.
- Persisting every delta would bloat SQLite and violate the temporary-content boundary.
