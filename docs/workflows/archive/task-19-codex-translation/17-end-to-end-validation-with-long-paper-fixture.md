# 19.17 End-to-end validation with long paper fixture

## Goal

Verify that Brilliant completes a long academic-style document without omission.

## Files likely owned

- `tests/server/translation/brilliant-e2e.test.ts` or the project-equivalent E2E test path
- `tests/fixtures/translation/academic-paper.md`
- PR description / handoff notes

## Contract references

- `contracts/02-types-state-and-settings.md`
- `contracts/03-sqlite-and-repositories.md`
- `contracts/04-api-and-sse.md`
- `contracts/05-markdown-chunking.md`
- `contracts/06-codex-prompt-and-validation.md`
- `contracts/07-atomic-commit-purge-recovery.md`

## Instruction alignment

Scope: integrated Brilliant validation over a long academic-style fixture using fake Codex by default.

Inputs: persisted settings language, source fixture memory, fake app-server stream, chunker, validator, stitcher, atomic writer, and reader route.

Outputs: end-to-end proof that long document translation completes, commits, purges, streams, and renders through dedicated routes/tabs.

Dependencies: all prior Brilliant subtasks.

Parallelization notes: this is final integration and should not run before schema, runner, Codex client, validation, commit, and reader route contracts are implemented.

Implementation risks: validating only the happy path misses retry, purge, stale, and route/content mismatch requirements.

## Required integration checks

Manual or automated smoke:

1. Set `/settings` translation target language to `ja-JP` and confirm SQLite persists it.
2. Load a memory backed by the long academic fixture.
3. Start translation with `POST /api/memories/:memory_id/translations` without trusting a client language as canonical.
4. Confirm job uses `ja-JP` from SQLite settings.
5. Confirm chunker creates multiple block-group chunks.
6. Confirm fake Codex app-server requires app-server initialization, starts ephemeral chunk-attempt threads, emits deltas, and returns final structured outputs.
7. Inject one validation failure and confirm only the failed chunk retries.
8. Confirm every source block id appears exactly once in validated translated output.
9. Confirm source frontmatter, when present, is preserved unchanged at the top of translated output.
10. Confirm final stitched Markdown passes full-document validation.
11. Confirm final file is committed to `memories/<memory_id>/ja-JP/CONTENT.md`.
12. Confirm source `memories/<memory_id>/CONTENT.md` is unchanged.
13. Confirm `translation_jobs` records completion, output path, output hash, and source hash.
14. Confirm `translation_chunks.translated_markdown` is purged after commit.
15. Confirm the dedicated translated reader route renders the `ja-JP` variant only when the current source hash matches `translation_jobs.source_hash` and the file hash matches `translation_jobs.output_hash`.
16. Confirm translated routes do not render the Codex translation icon.
17. Confirm the source route hides the Codex icon after the `ja-JP` variant exists.
18. Confirm variant tabs render under the header and label `ja-JP` as `Japanese`.
19. Confirm stale translated files are not shown as current tabs after source hash changes.
20. Confirm historical completed jobs for older source hashes return `reader_url: null`.
21. Confirm complete jobs with missing or hash-mismatched output are marked unavailable and do not block a fresh translation.
22. Confirm stale running jobs emit `translation.job.stale`.
23. Confirm a missing or stale translated route returns the project-standard not-found response and does not silently render source content.
24. Confirm SSE shows progress from job start through completion and completed payload includes `reader_url`.

## Commands

```sh
mise exec -- bun run test tests/server/translation/brilliant-e2e.test.ts
mise exec -- bun run typecheck
mise exec -- bun run verify
```

Optional live Codex smoke is not required for MVP completion. If a live Codex run is attempted, document the exact app-server URL, command, credentials boundary, and outcome in the PR handoff. If it is not attempted, explicitly record `live Codex smoke: not attempted`.

## PR handoff checklist

PR body must include:

- SQLite schema/migration summary
- settings language persistence strategy
- API summary
- Codex app-server integration boundary
- SSE progress strategy
- chunking and validation strategy
- atomic commit and purge strategy
- crash recovery strategy
- reader UI/rendering summary
- exact verification commands and outcomes
- live Codex smoke status, if attempted
- known deferred work

## Acceptance criteria

- Long paper translation completes through chunking, validation, retry, stitching, atomic commit, and purge.
- Source content remains unchanged.
- Translated content is stored only at `memories/<memory_id>/<lang_code>/CONTENT.md` after completion.
- SQLite retains metadata but not completed translated article bodies.
- Reader can render the translated variant.
- Reader exposes translated variants through dedicated routes and tabs.
- Reader shows the Codex icon only before the configured target variant exists.
- Reader does not expose stale translated files as current variants.
- Completed job events include the translated reader URL.
- Verification results are documented for handoff.
