# Verification Strategy

Trauma uses an E2E-first verification strategy.

## E2E Coverage

Playwright should cover the main user workflows:

- Add memory success path.
- Link-only fallback when extraction fails.
- Markdown file creation.
- `/memories` list rendering.
- `/memories/:id` reader rendering.
- Category/tag filtering.
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
