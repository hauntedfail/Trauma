# 19.16 Test plan and fixtures

## Goal

Create deterministic fixtures and test coverage for Brilliant without requiring live Codex for normal verification.

## Files likely owned

- `tests/fixtures/translation/simple-article.md`
- `tests/fixtures/translation/academic-paper.md`
- `tests/fixtures/translation/hostile-prompt-injection.md`
- `tests/fixtures/translation/markdown-protected-spans.md`
- optional `tests/server/translation/fakes/fake-codex-app-server.ts`
- tests listed by the subtasks above

## Contract references

Read the focused contract files for the tests being implemented. Do not load every contract unless building the final E2E test.

## Instruction alignment

Scope: deterministic fixtures, fake app-server support, and normal verification coverage.

Inputs: all frozen Brilliant contracts, hostile article examples, academic-paper structure, and fake Codex app-server events.

Outputs: translation fixtures, test coverage checklist, fake app-server utility if needed, and non-live verification command list.

Dependencies: runs after interface shapes from 19.2 through 19.13 are frozen.

Parallelization notes: fixture writing can proceed early, but integrated fake app-server tests should wait for event and client contracts.

Implementation risks: relying on live Codex for normal tests makes CI nondeterministic; omitting hostile/long fixtures misses core instruction requirements.

## Fixture contract

`simple-article.md` contains:

- frontmatter
- one heading
- two paragraphs
- one image
- one link

`markdown-protected-spans.md` contains:

- code fence
- inline code
- math block
- citation marker
- footnote
- Markdown link
- raw HTML block
- command and file path examples

`hostile-prompt-injection.md` contains:

- text telling the model to ignore instructions
- text asking the model to omit paragraphs
- text asking the model to print secrets

`academic-paper.md` contains:

- abstract
- numbered sections
- equations
- citations
- table
- footnotes
- references/bibliography
- enough repeated structure to require multiple chunks under default test config

## Required verification commands

```sh
mise exec -- bun run test tests/server/db/translation-schema.test.ts
mise exec -- bun run test tests/server/db/translation-repositories.test.ts
mise exec -- bun run test tests/server/settings/translation-language.test.ts
mise exec -- bun run test tests/server/translation/source-loader.test.ts
mise exec -- bun run test tests/server/translation/markdown-blocks.test.ts
mise exec -- bun run test tests/server/translation/chunker.test.ts
mise exec -- bun run test tests/server/translation/job-state.test.ts
mise exec -- bun run test tests/server/translation/codex-app-server.test.ts
mise exec -- bun run test tests/server/translation/prompt.test.ts
mise exec -- bun run test tests/server/translation/validator.test.ts
mise exec -- bun run test tests/server/translation/stitcher.test.ts
mise exec -- bun run test tests/server/translation/atomic-writer.test.ts
mise exec -- bun run test tests/server/translation/events.test.ts
mise exec -- bun run test tests/server/translation/orchestrator.test.ts
mise exec -- bun run test tests/server/routes/api-memory-translations.test.ts
mise exec -- bun run test tests/server/routes/api-translation-jobs.test.ts
mise exec -- bun run test tests/server/routes/api-translation-events.test.ts
mise exec -- bun run test tests/server/reader/translated-page-data.test.ts
mise exec -- bun run test tests/components/reader-translation-controls.test.tsx
mise exec -- bun run test tests/components/reader-translation-progress.test.tsx
mise exec -- bun run typecheck
```

## Coverage checklist

- BCP 47 language persistence and traversal rejection
- supported-language canonical casing: `ja-JP` accepted, `ja-jp`/`JA-JP` redirected only through a project-standard canonical redirect helper or rejected as not found
- settings select options, prompt display names, and variant tab labels use one central supported-language table
- translation start using SQLite settings language
- `409 translation_language_required`
- `409 translation_language_mismatch`
- source hash and stale detection
- stale source emits `translation.job.stale` as a terminal event
- deterministic block ids and chunk grouping
- source frontmatter is preserved unchanged in translated `CONTENT.md`
- prompt injection containment
- partial delta streaming as non-authoritative progress
- chunk validation success and failure
- chunk-level retry
- final stitching order
- atomic writer failure cases
- purge of `translated_markdown` after commit
- public `completed_chunks` counts purged chunks as completed after commit
- failed or interrupted final writes delete `.CONTENT.<job_id>.tmp` temp files
- source rendering and translated variant rendering
- auth-required and setup-required UI states
- JSON-RPC app-server initialization before requests
- URL-based app-server transport support and `stdio` rejection for Brilliant MVP
- `thread/start`, `turn/start`, and `turn/interrupt` coverage
- `outputSchema` rejection falls back to prompt-only JSON output and still validates `CodexChunkOutput`
- `app_server_unavailable` maps to HTTP `503`
- Codex `timeout` maps to stable `timeout` code and HTTP `504`
- Codex `stream_disconnected` maps to stable `stream_disconnected` code and HTTP `503`
- Codex `invalid_final_output` maps to stable `invalid_final_output` code and HTTP `502`
- device-code login safe fields and completion notification handling
- pending device-code refresh returns only safe metadata or latest confirmed `account/read` state
- device-code auth observer is created only while login is pending and is cleaned up on completion/cancel/failure/timeout
- auth listener loss or server restart falls back to `checkAuth()` and safe pending metadata
- completed event includes `reader_url`
- API errors use stable `code` values consumed by frontend state branches
- historical completed jobs for older source hashes return `reader_url: null`
- stale translated files are not exposed as current tabs
- translated output hash mismatch is not exposed as a current route, current tab, or non-null `reader_url`
- missing or hash-mismatched output for a complete row marks the job unavailable and does not block retranslation
- `translation_unavailable` is a required API error code and frontend branch
- `translation_unavailable` uses `action = "start_fresh_translation"`
- unavailable job snapshots return `reader_url: null` and `error.code = "translation_unavailable"`
- current translation metadata API returns `409 translation_unavailable` for complete rows with missing or hash-mismatched output
- job start, metadata API, reader route, and variant tabs use one shared current-translation resolver
- reader route and variant tab rendering use read-only current-translation resolution and do not mark rows unavailable
- job start and metadata API use explicit unavailable repair before retry/recovery
- 19.3 owns `current-translation.ts`; 19.13 consumes it read-only; 19.11 recovery reuses `repairUnavailableTranslation()`
- job snapshot errors include optional `action`, including `start_fresh_translation`
- unavailable status is snapshot-only and does not emit a dedicated SSE terminal event

## Acceptance criteria

- Normal tests use fake Codex app-server.
- Live Codex smoke is optional and separate from deterministic CI.
- Fixtures cover hostile content and long academic-paper structure.
- Cleanup and purge are tested, not only successful file output.
