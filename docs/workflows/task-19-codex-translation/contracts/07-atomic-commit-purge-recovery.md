# Brilliant atomic commit, purge, and recovery contract

## Commit sequence

Use this exact sequence:

1. Re-read current source `CONTENT.md` hash.
2. If current source hash differs from job `source_hash`, mark job `stale` and stop.
3. Stitch validated chunks in block order.
4. Validate final full document.
5. Ensure store-relative `memories/<memory_id>/<lang_code>/` exists under configured `storePath`.
6. Write full Markdown to store-relative `memories/<memory_id>/<lang_code>/.CONTENT.<job_id>.tmp`.
7. Flush file contents.
8. Rename temp file to `memories/<memory_id>/<lang_code>/CONTENT.md`.
9. Flush parent directory if supported.
10. Compute `output_hash` from committed `CONTENT.md`.
11. In a SQLite transaction, set job `status = 'complete'`, `output_path`, `output_hash`, and `completed_at`.
12. In the same transaction or immediately following transaction, set completed chunks to `status = 'purged'`, `translated_markdown = NULL`, preserving `translated_hash`.
13. Emit `translation.job.completed` only after purge succeeds.

## Final paths

```text
memories/<memory_id>/<lang_code>/CONTENT.md
memories/<memory_id>/<lang_code>/.CONTENT.<job_id>.tmp
```

## Purge SQL

```sql
UPDATE translation_chunks
SET translated_markdown = NULL,
    status = 'purged',
    updated_at = ?
WHERE job_id = ?
  AND status = 'complete';
```

## Recovery cases

1. Pending job exists without a running worker: if source hash still matches, schedule it; if source hash changed, mark stale.
2. Temp file exists, final file absent, job not complete: delete temp and mark failed or retryable.
3. Final file exists, job complete, chunks not purged: purge before reporting complete.
4. Final file exists, job not complete, all chunks complete: verify hash, complete job, purge.
5. Source hash changed during interrupted non-complete job: mark stale.

## Rules

- Existing completed translation must remain intact if write, flush, rename, DB update, or purge fails.
- Source `CONTENT.md` is never mutated.
- Completion event is emitted only after purge succeeds.
- Startup recovery cannot report complete until final file exists, hash matches, and purge is done.
- Completed jobs are immutable history. If source content changes later, keep the completed job status unchanged and derive stale/current state at read time.
