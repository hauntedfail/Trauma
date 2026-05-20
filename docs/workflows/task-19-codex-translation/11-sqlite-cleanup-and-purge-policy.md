# 19.11 SQLite cleanup and purge policy

## Goal

Ensure completed translated chunk bodies do not remain in SQLite after final file commit.

## Scope

Implement purge rules, audit metadata retention, startup recovery for interrupted jobs, and cleanup tests. This subtask owns privacy/storage hygiene after translation completes.

## Inputs

- 19.2 schema
- 19.3 state machine
- 19.10 commit success signal

## Outputs

- Purge function for completed chunk bodies.
- Recovery policy for jobs stuck after crash or interruption.
- Tests proving completed chunk bodies are nulled after commit.

## Dependencies

- 19.2 schema must exist.
- 19.10 must expose a reliable commit-complete boundary.

## Acceptance criteria

- After successful final `CONTENT.md` commit, `translation_chunks.translated_markdown` is set to `NULL` for that job.
- Purged chunk rows retain `translated_hash`, `status`, `retry_count`, `error`, `block_ids_json`, and timestamps needed for audit and stale detection.
- The job remains queryable after purge.
- Failed jobs may retain temporary chunk output only when needed for retry/debug and only within the documented retention policy.
- A startup recovery path identifies jobs that were committing or running when the process stopped.
- Recovery never marks a job complete unless the final file exists, output hash matches, and purge is complete.
- Cleanup behavior is covered by tests.

## Parallelization notes

This can run after 19.2 and beside 19.10 if the commit/purge handoff is explicitly defined.

## Implementation risks

- Forgetting purge creates a second persistent translated article store in SQLite.
- Purging before final file commit can destroy the only successful translation output.
- Crash recovery must handle the gap between rename success and SQLite update.
