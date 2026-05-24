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

## Instruction alignment

Scope: validated chunk stitching, durable projection sidecar emission, and atomic final translated `CONTENT.md` commit.

Inputs: complete validated chunks, original manifest order, current source hash, and output path contract.

Outputs: stitched Markdown, same-directory temp file, atomic rename, output hash, projection rows, `TRANSLATION_MAP.json`, and final output metadata.

Dependencies: 19.9 completes chunk validation; 19.2 provides repository methods; 19.11 purges completed chunk bodies.

Parallelization notes: can run with purge policy only after final path and transaction boundaries are frozen.

Implementation risks: writing outside the language directory, skipping source re-hash, or emitting completion before purge can corrupt existing translations.

## Stitching contract

- Stitch completed translated chunk Markdown in original chunk order.
- Rebase validated chunk projection spans to final translated document offsets.
- Do not include internal chunk metadata in final Markdown.
- If the source file had frontmatter, prepend the exact original frontmatter unchanged before the stitched translated body.
- If the source file had no frontmatter, do not invent frontmatter.
- Preserve source-level document structure after translation.
- Final validation checks chunk count, incomplete chunks, duplicate sections caused by retries, frontmatter preservation, and Markdown sanity. Segment ids are validated before chunk Markdown is persisted.

## Atomic write contract

Final path:

```text
memories/<memory_id>/<lang_code>/CONTENT.md
memories/<memory_id>/<lang_code>/TRANSLATION_MAP.json
```

Temporary path:

```text
memories/<memory_id>/<lang_code>/.CONTENT.<job_id>.tmp
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
- source frontmatter is preserved unchanged at the top of translated output
- projection rows and `TRANSLATION_MAP.json` are written for the committed output hash
- translated output without source frontmatter does not invent frontmatter
- incomplete chunk fails final validation
- duplicate or missing chunk index fails final validation
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
