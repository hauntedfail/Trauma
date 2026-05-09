# Task 09: E2E Integration Hardening Workflow

## Goal

Turn the feature slices into deterministic end-to-end workflows that prove the
foundation works as one system.

## Required Context

- [Verification strategy](../quality/verification.md)
- [Runtime flows](../architecture/flows.md)
- [UI and routing architecture](../architecture/ui-and-routing.md)

## Ownership

Primary files and directories:

- `e2e/**`
- `tests/fixtures/**`
- Test utilities under `tests/**`
- Verification docs under `docs/quality/**`
- Package scripts only if needed for deterministic setup.

Do not add product behavior in this task unless it is test-only plumbing.

## Implementation Steps

1. Define test isolation strategy.
   - Per-run SQLite database.
   - Per-run markdown store.
   - No writes to real `data/` or `.trauma/`.

2. Build deterministic fixtures.
   - Successful import fixture.
   - Failed extraction fixture.
   - Existing memory fixture for reader.
   - Git backup fixture using a temporary repository.

3. Expand Playwright coverage.
   - Add memory success path.
   - Link-only fallback.
   - Markdown file creation.
   - `/memories` list rendering.
   - `/memories/:id` reader rendering.
   - `/highlights` excerpt rendering.
   - Category/tag filtering.
   - Search matching highlight-only text.
   - Highlight selection and persistence.
   - Backup status display.

4. Add setup/teardown utilities.
   - Clear DB/store between tests.
   - Create fixture memories.
   - Capture useful artifacts on failure.

5. Update verification docs.
   - Document how to run E2E locally.
   - Document expected environment variables.
   - Record known test data locations.

## Acceptance Criteria

- `bun run test:e2e` is deterministic on a clean checkout.
- E2E tests do not depend on external websites.
- Test state is isolated and deleted or ignored.
- Verification docs explain exact commands and expected outputs.

## Verification

Run:

```bash
bun run typecheck
bun run test
bun run build
bun run test:e2e
```

## PR Handoff

The PR description must include:

- Fixture strategy.
- Isolation strategy.
- Any new scripts or environment variables.
- Exact verification commands and outcomes.
