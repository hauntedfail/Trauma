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
- translation start using SQLite settings language
- `409 translation_language_required`
- `409 translation_language_mismatch`
- source hash and stale detection
- deterministic block ids and chunk grouping
- prompt injection containment
- partial delta streaming as non-authoritative progress
- chunk validation success and failure
- chunk-level retry
- final stitching order
- atomic writer failure cases
- purge of `translated_markdown` after commit
- source rendering and translated variant rendering
- auth-required and setup-required UI states

## Acceptance criteria

- Normal tests use fake Codex app-server.
- Live Codex smoke is optional and separate from deterministic CI.
- Fixtures cover hostile content and long academic-paper structure.
- Cleanup and purge are tested, not only successful file output.
