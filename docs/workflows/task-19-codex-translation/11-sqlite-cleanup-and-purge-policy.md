# 19.11 SQLite cleanup and purge policy

## Goal

Ensure completed translated chunk bodies do not remain in SQLite after final file commit.

## Scope

Implement purge rules, audit metadata retention, startup recovery for interrupted jobs, temp-file cleanup, and cleanup tests.

## Inputs

- `docs/workflows/task-19-codex-translation/00-execution-contracts.md`
- 19.2 schema
- 19.3 state machine
- 19.10 commit success boundary

## Outputs

- Implement purge in `src/server/translation/job-state.ts` or repository layer
- Implement recovery in `src/server/translation/orchestrator.ts` or startup hook selected in 19.1
- Test: `tests/server/translation/job-state.test.ts`
- Test: `tests/server/translation/orchestrator.test.ts`

## Dependencies

- 19.2 schema.
- 19.10 commit/purge boundary.

## Concrete purge SQL

```sql
UPDATE translation_chunks
SET translated_markdown = NULL,
    status = 'purged',
    updated_at = ?
WHERE job_id = ?
  AND status = 'complete';
```

Recovery cases:

1. Temp file exists, final file absent, job not complete: delete temp and mark failed or retryable.
2. Final file exists, job complete, chunks not purged: purge before reporting complete.
3. Final file exists, job not complete, all chunks complete: verify hash, complete job, purge.
4. Source hash changed during interrupted job: mark stale.

## Acceptance criteria

- Completed jobs have no non-null `translated_markdown` rows.
- Purged chunks retain `translated_hash`, `block_ids_json`, retry count, status, and timestamps.
- Failed jobs retain temporary output only under documented retry/debug retention.
- Startup recovery cannot report complete until file exists, hash matches, and purge is done.
- Tests cover all recovery cases above.

## Parallelization notes

Can run after 19.2 and beside 19.10 if handoff is frozen.

## Implementation risks

- Purging before final file commit destroys the only successful output.
- Forgetting purge creates a second persistent article store.
- Startup recovery must not silently delete a valid committed translation.
