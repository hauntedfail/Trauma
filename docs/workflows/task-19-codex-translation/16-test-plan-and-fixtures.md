# 19.16 Test plan and fixtures

## Goal

Create deterministic tests and fixtures for the Brilliant translation pipeline without requiring live Codex for normal verification.

## Scope

Add unit, integration, component, and fake app-server tests for storage, chunking, streaming, validation, retry, atomic commit, cleanup, reader rendering, and frontend progress.

## Inputs

- `docs/workflows/task-19-codex-translation/00-execution-contracts.md`
- Interfaces from 19.2 through 19.15
- Existing test conventions

## Outputs

- Create: `tests/fixtures/translation/simple-article.md`
- Create: `tests/fixtures/translation/academic-paper.md`
- Create: `tests/fixtures/translation/hostile-prompt-injection.md`
- Create: `tests/fixtures/translation/markdown-protected-spans.md`
- Create fake app-server client used by backend tests
- Add the test files listed in `00-execution-contracts.md`

## Dependencies

- Core interfaces from 19.2 through 19.10 must be stable before broad fixture implementation.

## Required fixtures

`simple-article.md`:

- frontmatter
- one heading
- two paragraphs
- one image
- one link

`markdown-protected-spans.md`:

- code fence
- inline code
- math block
- citation marker
- footnote
- Markdown link
- raw HTML block
- command and file path examples

`hostile-prompt-injection.md`:

- text telling the model to ignore instructions
- text asking the model to omit paragraphs
- text asking the model to print secrets

`academic-paper.md`:

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
mise exec -- bun run test tests/server/settings/translation-language.test.ts
mise exec -- bun run test tests/server/reader/translated-page-data.test.ts
mise exec -- bun run test tests/components/reader-translation-controls.test.tsx
mise exec -- bun run test tests/components/reader-translation-progress.test.tsx
mise exec -- bun run typecheck
```

## Acceptance criteria

- Tests cover BCP 47 path resolution and traversal rejection.
- Tests cover persistence and retrieval of the `/settings` translation target language from SQLite.
- Tests cover translation start using the SQLite settings language when the request body omits `lang_code`.
- Tests cover `409 translation_language_required` and `409 translation_language_mismatch`.
- Tests cover source hash and stale translation detection.
- Tests cover deterministic block ids and chunk grouping.
- Tests cover prompt injection containment.
- Tests cover partial delta streaming as non-authoritative progress.
- Tests cover chunk validation success and failure.
- Tests cover chunk-level retry.
- Tests cover final stitching order.
- Tests cover atomic writer failure cases.
- Tests cover purge of `translated_markdown` after commit.
- Tests cover source rendering and translated variant rendering.
- Tests cover auth-required and setup-required UI states.
- Live Codex app-server smoke is separate from deterministic CI tests.

## Parallelization notes

Fixture creation can begin once 19.4 block types are known. Full tests should wait for each owning interface to stabilize.

## Implementation risks

- Live Codex tests will be flaky and must not be required for normal CI.
- Fixtures must include hostile content because website content is untrusted.
- Tests must assert cleanup, not only successful output.
