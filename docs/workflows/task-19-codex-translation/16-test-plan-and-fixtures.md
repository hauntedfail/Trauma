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
- current committed translation reuse returns `200 current` without checking Codex auth
- active job reuse returns `status = "active"`, the actual `job_status`, and the existing `event_url` without creating another row
- compatible `cancel_requested` job returns `409 cancellation_conflict` until cancellation reaches `canceled`
- active job reuse triggers or depends on focused recovery so stale old-source jobs are marked `stale` before new job creation
- reused pending/running job whose Codex auth/setup is now missing becomes failed with `auth_required` or `setup_required`
- auth/setup precondition failures return `409` without creating `translation_jobs` rows only when a new job would be required
- in-flight auth/setup loss after job creation persists `auth_required` or `setup_required` as a safe job error
- `409 translation_language_required`
- `409 translation_language_mismatch`
- source hash and stale detection
- stale source emits `translation.job.stale` as a terminal event
- deterministic block ids and chunk grouping
- source frontmatter is preserved unchanged in translated `CONTENT.md`
- prompt injection containment
- partial delta streaming as non-authoritative progress
- SSE job/chunk failure events include safe error objects with stable codes
- chunk validation success and failure
- chunk errors persist structured `TranslationPersistedError` JSON in `translation_chunks.error`
- invalid final output covers JSON parse/schema failure; validation failed covers schema-valid semantic failure
- chunk-level retry
- final stitching order
- atomic writer failure cases
- purge of `translated_markdown` after commit
- public `completed_chunks` counts purged chunks as completed after commit
- failed or interrupted final writes delete `.CONTENT.<job_id>.tmp` temp files
- source rendering and translated variant rendering
- auth-required and setup-required UI states
- JSON-RPC app-server initialization before requests
- Unix socket default JSON-RPC transport support only when Codex is started with `codex app-server --listen unix://`, loopback WebSocket local-dev fallback support, HTTP JSON-RPC rejection, non-loopback WebSocket rejection, and `stdio` rejection for Brilliant MVP
- Unix socket adapter spike documents Bun/Node support for Unix domain socket plus HTTP Upgrade/WebSocket framing and the default `unix://` socket path resolution
- Codex app-server protocol schema or focused fixture version is recorded and used by fake app-server tests
- Codex app-server fixtures use `{ method, params, id }` requests, `{ id, result/error }` responses, and `{ method, params }` notifications without top-level `jsonrpc`
- `thread/start`, `turn/start`, and `turn/interrupt` coverage
- retry attempts create fresh ephemeral Codex threads and do not reuse failed attempt thread history
- translation `turn/start` uses locked-down approval, sandbox, network, and cwd settings
- job-scoped runtime `cwd` is created outside project/store roots and cleaned up on terminal job states
- runtime directory cleanup validates canonical root containment, rejects symlinks/traversal, refuses project/store/backup/article paths, and deletes only empty job-scoped directories
- non-empty runtime cleanup leftovers produce safe server logs only and do not create a blocking frontend popup or require a diagnostics SQLite column in MVP
- `networkAccess = false` is tested as sandbox/tool-network control and does not block required app-server/model traffic
- locked-down `turn/start` policy payload is verified against generated app-server schema or focused protocol fixtures before implementation
- translation `thread/start` also uses locked-down policy where supported, or tests document that `turn/start` overrides broader thread defaults
- `outputSchema` rejection falls back to prompt-only JSON output and still validates `CodexChunkOutput`
- `app_server_unavailable` maps to HTTP `503`
- Codex `timeout` maps to stable `timeout` code and HTTP `504`
- Codex `stream_disconnected` maps to stable `stream_disconnected` code and HTTP `503`
- Codex `invalid_final_output` maps to stable `invalid_final_output` code and HTTP `502`
- device-code login safe fields and success/failure/cancellation notification handling
- pending device-code refresh returns only safe metadata or latest confirmed `account/read` state
- device-code auth observer is created only while login is pending and is cleaned up on completion/cancel/failure/timeout
- auth listener loss or server restart falls back to `checkAuth()` and safe pending metadata
- default app-server endpoint uses Unix socket `unix://`
- loopback WebSocket endpoint `ws://127.0.0.1:4500` is tested only as local development fallback
- cancellation accepts pending/running jobs, is idempotent for already canceling/canceled jobs, and rejects non-cancelable terminal/final-write states with `cancellation_conflict`
- recovered non-resumable `cancel_requested` job becomes `canceled` so it does not block future retries indefinitely
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
- job start and metadata API use `resolveCurrentTranslationReadOnly()` plus explicit `repairUnavailableTranslation()` when mutation is allowed
- reader route and variant tabs use `resolveCurrentTranslationReadOnly()` only and never call `repairUnavailableTranslation()`
- reader route and variant tab rendering use read-only current-translation resolution and do not mark rows unavailable
- runtime translation prompt builder does not require `$reader-translate` skill invocation or project-root read access
- `prompt_policy_version` records deterministic prompt policy provenance without implying runtime skill invocation
- `BRILLIANT_PROMPT_POLICY_VERSION = "brilliant-prompt-v1"` is stored on new jobs and changes only by explicit prompt policy bump
- job start and metadata API use explicit unavailable repair before retry/recovery
- job status/snapshot API uses explicit unavailable repair before returning unavailable snapshots
- unavailable repair persists structured JSON error with reason `output_missing` or `output_hash_mismatch`
- 19.3 owns `current-translation.ts`; 19.13 consumes it read-only; 19.11 recovery reuses `repairUnavailableTranslation()`
- job snapshot errors include optional `action`, including `start_fresh_translation`
- unavailable status is snapshot-only and does not emit a dedicated SSE terminal event

## Acceptance criteria

- Normal tests use fake Codex app-server.
- Live Codex smoke is optional and separate from deterministic CI.
- Fixtures cover hostile content and long academic-paper structure.
- Cleanup and purge are tested, not only successful file output.
