# Brilliant atomic commit, purge, and recovery contract

## Commit sequence

Use this exact sequence:

1. Re-read current source `CONTENT.md` hash.
2. If current source hash differs from job `source_hash`, mark job `stale`, emit `translation.job.stale`, and stop.
3. Stitch validated chunks in block order.
4. Validate final full document.
5. Ensure store-relative `memories/<memory_id>/<lang_code>/` exists under configured `storePath`.
6. Write full Markdown to store-relative `memories/<memory_id>/<lang_code>/.CONTENT.<job_id>.tmp`.
7. Flush file contents.
8. Rename temp file to `memories/<memory_id>/<lang_code>/CONTENT.md`.
9. Flush parent directory if supported.
10. Compute `output_hash` from committed `CONTENT.md`.
11. Rebase validated chunk projection spans to full translated document offsets.
12. Write `TRANSLATION_MAP.json` beside translated `CONTENT.md`.
13. Replace durable `translation_projection_spans` rows for the job.
14. In SQLite, set job `status = 'complete'`, `output_path`, `output_hash`, and `completed_at`.
15. Set completed chunks to `status = 'purged'`, `translated_markdown = NULL`, and `projection_spans_json = NULL`, preserving `translated_hash`.
16. Derive `reader_url` as `/memories/<lang_code>/<memory_id>`.
17. Emit `translation.job.completed` only after purge succeeds, including `output_path`, `output_hash`, and derived `reader_url`.

## Final paths

```text
memories/<memory_id>/<lang_code>/CONTENT.md
memories/<memory_id>/<lang_code>/TRANSLATION_MAP.json
memories/<memory_id>/<lang_code>/.CONTENT.<job_id>.tmp
```

## Purge SQL

```sql
UPDATE translation_chunks
SET translated_markdown = NULL,
    projection_spans_json = NULL,
    status = 'purged',
    updated_at = ?
WHERE job_id = ?
  AND status = 'complete';
```

## Recovery cases

1. Pending job exists without a running worker: if source hash still matches, schedule it; if source hash changed, mark stale.
2. Temp file exists, final file absent, job not complete: delete temp and mark failed or retryable.
3. Final file missing or hash-mismatched for a complete job: mark the job `unavailable` and allow a future retry for the same `(memory_id, lang_code, source_hash)`.
4. Final file exists, job complete, chunks not purged: purge before reporting complete.
5. Final file exists, job not complete, all chunks complete: re-stitch completed chunk bodies, compute the expected output hash, and compare it with the existing final file hash. Complete and purge only when the current source hash still matches and the final file hash equals the re-stitched output hash. If the final file differs, do not assume it belongs to this job. A rewrite is allowed only when the current source hash still matches `translation_jobs.source_hash`, all required completed chunk bodies are still available for re-stitching, final validation passes, and the same-directory temp-file plus atomic rename sequence can run again safely. Otherwise preserve the existing final file and mark the interrupted job failed with `filesystem_failure`.
6. Source hash changed during interrupted non-complete job: mark stale.

## Rules

- Existing completed translation must remain intact if write, flush, rename, DB update, or purge fails.
- Source `CONTENT.md` is never mutated.
- Completion event is emitted only after purge succeeds.
- Startup recovery cannot report complete until final file exists, hash matches, and purge is done.
- Recovery must never mark an interrupted job complete merely because `memories/<memory_id>/<lang_code>/CONTENT.md` exists. The file must match the re-stitched output hash for that job.
- Recovery must never overwrite an existing final `CONTENT.md` unless it can re-stitch this job's completed chunk bodies, validate the output, confirm the current source hash still matches, and perform the full atomic commit sequence again.
- Completed jobs are immutable history. If source content changes later, keep the completed job status unchanged and derive stale/current state at read time.
- If a complete job's committed output file is missing or hash-mismatched, mark it `unavailable` instead of reporting it as current.
- Same-directory `.CONTENT.<job_id>.tmp` files are short-lived final-write artifacts only. Do not retain them for failed-job debugging. If a commit fails before final rename or recovery finds an orphan temp file, delete the temp file and preserve failure diagnostics in SQLite metadata/logs instead.
