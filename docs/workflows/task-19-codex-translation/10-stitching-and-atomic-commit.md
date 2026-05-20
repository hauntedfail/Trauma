# 19.10 Stitching and atomic commit

## Goal

Stitch validated chunks into final translated Markdown and atomically commit `memory/<memory_id>/<lang_code>/CONTENT.md`.

## Scope

Implement manifest-order stitching, final document validation, translated frontmatter writing if used, same-directory temp file writing, file flush, atomic rename, parent directory flush when supported, and final metadata update.

## Inputs

- 19.4 block manifest
- 19.9 validated chunk outputs
- 19.2 job metadata schema
- Existing memory store path resolver

## Outputs

- Stitcher module.
- Atomic translated content writer.
- Committed translated file at `memory/<memory_id>/<lang_code>/CONTENT.md`.
- Output hash and store-relative output path.

## Dependencies

- 19.2 for output metadata fields.
- 19.4 for block order.
- 19.9 for validated chunk outputs.

## Acceptance criteria

- Final output is stitched in manifest block order.
- Final validation confirms chunk count, block count, missing block ids, duplicate block ids, duplicated sections caused by retries, and Markdown sanity.
- The translated output path is exactly `memory/<memory_id>/<lang_code>/CONTENT.md`.
- Temporary final-write files live in the same language directory and are short-lived, for example `.CONTENT.<job_id>.tmp`.
- Failed or interrupted jobs do not corrupt an existing completed translation.
- Commit sequence creates the language directory, writes the full temp file, flushes file contents, atomically renames to `CONTENT.md`, flushes the parent directory when supported, marks job complete in SQLite, and triggers chunk-body purge.
- Source `memory/<memory_id>/CONTENT.md` is never mutated.

## Parallelization notes

This should run after 19.9. It can run beside 19.11 if the interface between commit success and purge is frozen.

## Implementation risks

- Cross-directory temp files can make rename non-atomic.
- Marking SQLite complete before rename can leave metadata pointing to a missing file.
- Parent directory fsync may not be supported on every platform; unsupported behavior must be handled explicitly without hiding commit failures.
