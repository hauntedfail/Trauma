# Verification Strategy

Trauma uses an E2E-first verification strategy.

## E2E Coverage

Playwright should cover the main user workflows:

- Add memory success path.
- Link-only fallback when extraction fails.
- Markdown file creation.
- `/memories` list rendering.
- `/memories/:id` reader rendering.
- `/highlights` highlight excerpt rendering.
- Category/tag filtering.
- `/memories?q=...` matching highlight text.
- Highlight selection and persistence.
- Highlight toggle removal when selecting already-highlighted text.
- Backup status display.

E2E tests should use controlled URLs or fixtures so extraction behavior is
deterministic.

## Focused Tests

Unit or integration tests should cover:

- Config validation.
- Drizzle repositories.
- Importer success and failure mapping.
- Markdown store writer.
- Highlight marker insertion.
- Highlight marker removal, shrink, and split behavior.
- Backup queue behavior.
- Reader sanitization and rendering.

## Completion Bar

A change that affects storage, import, highlights, backup, routing, or reader
rendering should include either E2E coverage or a clear reason why focused tests
are sufficient.

Do not claim an implementation is complete without running the relevant
verification commands and recording their outcomes.

## Review Follow-Up

When a valid review finding exposes a reproducible bug, invariant gap, parser
edge case, or implementation anti-pattern, the fix should include one durable
guardrail:

- A regression test that fails without the fix.
- A shared constant, validator, or helper that removes duplicated logic.
- A coding-standard or architecture note when the issue is cross-cutting.

Review follow-up is not complete until thread-aware review state has been
checked after the fix is pushed and the corresponding review thread has a
concrete reply.
