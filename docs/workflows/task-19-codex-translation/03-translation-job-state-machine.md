# 19.3 Translation job state machine

## Goal

Implement the Reader-owned orchestration state machine for translation jobs and chunks.

## Scope

Define job lifecycle, chunk lifecycle, stale-source checks, retry transitions, cancellation state, and event emission points. This subtask owns orchestration semantics, not Codex transport internals.

## Inputs

- 19.1 architecture contract
- 19.2 schema and repository methods
- Existing memory content loading APIs

## Outputs

- A translation job service module.
- State transition helpers for jobs and chunks.
- Idempotent job start/reuse logic for `memory_id`, `lang_code`, and `source_hash`.
- Source-changed detection while a job is running.

## Dependencies

- 19.2 must provide schema and persistence primitives.
- 19.4 must provide manifest/chunk data before full translation execution can run.

## Acceptance criteria

- Starting a translation loads `memory/<memory_id>/CONTENT.md` and computes `source_hash`, file size, rough token estimate, source URL, source title, and document type hint when available.
- If a current committed translation exists for the same `source_hash`, the service reuses it instead of starting a new job.
- If the source hash changes during a running job, the job is failed or marked stale before commit.
- Job statuses are explicit and include pending/running/validating/failed/complete or their frozen equivalents.
- Chunk statuses are explicit and include pending/running/validating/failed/complete/purged or their frozen equivalents.
- Retry count is tracked per chunk, not only per job.
- Job state emits the required Reader events for started, queued, running, validating, retrying, stitching, committing, completed, and failed states.
- The state machine never marks a job complete before atomic file commit and chunk-body purge have succeeded.

## Parallelization notes

This can run beside 19.5 and 19.8 after 19.2 is available, but it should own the canonical service interface consumed by later tasks.

## Implementation risks

- Marking a job complete before purge can leave completed chunk bodies in SQLite indefinitely.
- Retrying an entire document for one bad chunk wastes usage and weakens long-paper reliability.
- Source freshness must be checked again at commit time, not only at job start.
