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

## Recovery contract

Handle these startup or job-resume cases:

1. Temp file exists, final file absent, job not complete: delete temp and mark failed or retryable.
2. Final file exists, job complete, chunks not purged: purge before reporting complete.
3. Final file exists, job not complete, all chunks complete: verify hash, complete job, purge.
4. Source hash changed during interrupted job: mark stale.

## Tests

Cover:

- completed chunks are purged after commit
- purged chunks retain hash and block ids
- failed jobs retain temporary output only under documented retention policy
- recovery purges complete job with unpurged chunks
- recovery handles temp file without final output
- recovery handles final file without complete DB status
- recovery marks stale when source hash changed

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
