# 19.10 Stitching and atomic commit

## Goal

Stitch validated translated chunks and atomically commit the final translated `CONTENT.md`.

## Files likely owned

- `src/server/translation/stitcher.ts`
- `src/server/translation/atomic-writer.ts`
- `tests/server/translation/stitcher.test.ts`
- `tests/server/translation/atomic-writer.test.ts`

## Contract references

- `contracts/03-sqlite-and-repositories.md`
- `contracts/05-markdown-chunking.md`
- `contracts/07-atomic-commit-purge-recovery.md`

## Stitching contract

- Stitch translated blocks in original manifest order.
- Do not include internal chunk metadata in final Markdown.
- Preserve source-level document structure after translation.
- Final validation checks chunk count, block count, missing block ids, duplicate block ids, duplicate sections caused by retries, and Markdown sanity.

## Atomic write contract

Final path:

```text
memory/<memory_id>/<lang_code>/CONTENT.md
```

Temporary path:

```text
memory/<memory_id>/<lang_code>/.CONTENT.<job_id>.tmp
```

Commit sequence follows `contracts/07-atomic-commit-purge-recovery.md` exactly.

Rules:

- Re-read source hash before commit.
- Do not mutate source `CONTENT.md`.
- Use same-directory temp file.
- Existing completed translation must remain intact if commit fails.
- Job completion event is emitted only after purge succeeds.

## Tests

Cover:

- stitched output follows manifest order
- missing block fails final validation
- duplicate block fails final validation
- source hash mismatch marks job stale before write
- temp file is same-directory
- failure before rename leaves existing translation intact
- failure after rename is recoverable
- source `CONTENT.md` is unchanged

## Verification

```sh
mise exec -- bun run test tests/server/translation/stitcher.test.ts
mise exec -- bun run test tests/server/translation/atomic-writer.test.ts
mise exec -- bun run typecheck
```

## Acceptance criteria

- Final translated file is committed atomically.
- Existing translations are not corrupted by failed jobs.
- Commit is safe for long multi-chunk documents.
