# 19.11 SQLite cleanup and purge policy

## Goal

Ensure SQLite does not retain completed translated chunk bodies after final commit.

## Files likely owned

- `src/server/translation/job-state.ts`
- `src/server/translation/orchestrator.ts`
- `src/server/db/repositories.ts`
- optional `src/server/db/translation-repositories.ts`
- `tests/server/translation/job-state.test.ts`
- `tests/server/translation/orchestrator.test.ts`
- `tests/server/db/translation-repositories.test.ts`

## Contract references

- `contracts/03-sqlite-and-repositories.md`
- `contracts/07-atomic-commit-purge-recovery.md`

## Instruction alignment

Scope: post-commit SQLite cleanup, completed chunk body purge, and crash recovery for final write states.

Inputs: job rows, chunk rows, final output file, temp file state, source hash, and output hash.

Outputs: purged chunk bodies, retained metadata, recovered terminal states, and stale non-complete jobs.

Dependencies: 19.2 provides schema/repository methods and 19.10 writes final output.

Parallelization notes: can run beside 19.10 only after commit sequence is frozen; avoid changing Codex client or frontend UI.

Implementation risks: retaining completed translated chunks in SQLite violates the instruction; reporting complete before purge creates false completion.

## Purge contract

After successful final file commit:

```sql
UPDATE translation_chunks
SET translated_markdown = NULL,
    status = 'purged',
    updated_at = ?
WHERE job_id = ?
  AND status = 'complete';
```

Rules:

- Preserve `translated_hash`.
- Preserve `block_ids_json`.
- Preserve retry count and timestamps.
- Do not emit `translation.job.completed` before purge succeeds.
- Public progress and snapshot aggregation counts purged chunks as completed chunks.
- Final-write temp files are not retained for failed-job debugging. Keep diagnostics in SQLite metadata/logs and delete `.CONTENT.<job_id>.tmp` after failed commit or recovery cleanup.

## Recovery contract

Handle these startup or job-resume cases:

1. Temp file exists, final file absent, job not complete: delete temp and mark failed or retryable.
2. Final file exists, job complete, chunks not purged: purge before reporting complete.
3. Final file exists, job not complete, all chunks complete: verify hash, complete job, purge.
4. Complete job with missing or hash-mismatched final output: mark unavailable.
5. Source hash changed during interrupted non-complete job: mark stale.

Completed jobs are immutable history while their final output remains available. If the source changes after completion, do not mutate the completed job to `stale`; reader/API freshness is derived by comparing current source hash with job `source_hash`. If the final output is missing or hash-mismatched, mark the job `unavailable` so the user can retry the same source hash.

## Tests

Cover:

- completed chunks are purged after commit
- purged chunks retain hash and block ids
- failed jobs do not retain `.CONTENT.<job_id>.tmp` final-write files
- recovery purges complete job with unpurged chunks
- recovery handles temp file without final output
- recovery deletes orphan final-write temp files
- recovery handles final file without complete DB status
- recovery marks complete jobs with missing or hash-mismatched final output unavailable
- recovery marks interrupted non-complete jobs stale when source hash changed
- completed jobs remain complete when source hash later changes; stale/current is derived at read time

## Verification

```sh
mise exec -- bun run test tests/server/db/translation-repositories.test.ts
mise exec -- bun run test tests/server/translation/job-state.test.ts
mise exec -- bun run test tests/server/translation/orchestrator.test.ts
mise exec -- bun run typecheck
```

## Acceptance criteria

- Completed translated body exists only on disk.
- SQLite retains metadata but not completed article text.
- Crash recovery cannot falsely report complete without purge.
