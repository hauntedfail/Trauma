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

## Required integration checks

Manual or automated smoke:

1. Set `/settings` translation target language to `ja-JP` and confirm SQLite persists it.
2. Load a memory backed by the long academic fixture.
3. Start translation with `POST /api/memories/:memory_id/translations` without trusting a client language as canonical.
4. Confirm job uses `ja-JP` from SQLite settings.
5. Confirm chunker creates multiple block-group chunks.
6. Confirm fake Codex app-server emits deltas and final structured outputs.
7. Inject one validation failure and confirm only the failed chunk retries.
8. Confirm every source block id appears exactly once in validated translated output.
9. Confirm final stitched Markdown passes full-document validation.
10. Confirm final file is committed to `memories/<memory_id>/ja-JP/CONTENT.md`.
11. Confirm source `memories/<memory_id>/CONTENT.md` is unchanged.
12. Confirm `translation_jobs` records completion, output path, output hash, and source hash.
13. Confirm `translation_chunks.translated_markdown` is purged after commit.
14. Confirm `/memories/:id?lang=ja-JP` renders the translated variant.
15. Confirm SSE shows progress from job start through completion.

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
- Verification results are documented for handoff.
