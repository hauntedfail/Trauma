# 19.10 Stitching and atomic commit

## Goal

Stitch validated chunks into final translated Markdown and atomically commit `memory/<memory_id>/<lang_code>/CONTENT.md`.

## Scope

Implement manifest-order stitching, final validation, translated frontmatter policy, same-directory temp file writing, fsync/flush behavior, atomic rename, output hash verification, and commit metadata update.

## Inputs

- `docs/workflows/task-19-codex-translation/00-execution-contracts.md`
- 19.4 block manifest
- 19.9 validated chunk outputs
- 19.2 job metadata schema

## Outputs

- Create: `src/server/translation/stitcher.ts`
- Create: `src/server/translation/atomic-writer.ts`
- Test: `tests/server/translation/stitcher.test.ts`
- Test: `tests/server/translation/atomic-writer.test.ts`

## Dependencies

- 19.2 for metadata fields.
- 19.4 for block order.
- 19.9 for validated chunk outputs.

## Concrete commit sequence

Use the 13-step atomic commit and purge sequence from `00-execution-contracts.md`.

Final path:

```text
memory/<memory_id>/<lang_code>/CONTENT.md
```

Temporary path:

```text
memory/<memory_id>/<lang_code>/.CONTENT.<job_id>.tmp
```

## Acceptance criteria

- Stitched output follows manifest block order exactly.
- Final validation detects missing, duplicate, or reordered block ids before writing.
- Existing completed translation remains intact if write, flush, rename, DB update, or purge fails.
- Source `CONTENT.md` is never mutated.
- Temp file is same-directory and short-lived.
- Job completion event is emitted only after purge succeeds.
- Tests simulate failure before rename and after rename.

## Parallelization notes

Should run after 19.9. Can run beside 19.11 if commit/purge handoff stays identical to the contract.

## Implementation risks

- Cross-directory temp files make rename non-atomic.
- DB complete before rename creates missing-file metadata.
- Rename success plus DB failure needs recovery handling.
