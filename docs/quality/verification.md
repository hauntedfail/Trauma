# Verification Strategy

TRAUMA uses an E2E-first verification strategy.

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

## Startup Smoke

`bun run dev:smoke` boots the dev server with a deterministic host and port,
probes `/memories`, then shuts the server down. The smoke check fails fast
when the server cannot bind, crashes early, or does not respond within the
timeout.

Use the smoke check before E2E runs and after toolchain or config changes
that could affect dev startup.

## Release Automation

`.github/workflows/release.yml` creates a GitHub Release from tag pushes after
running the same baseline verification and E2E smoke suite as CI.

Release tags must be three-part numeric semantic versions with an optional
leading `v`:

- `0.1.111`
- `v0.1.111`

The workflow intentionally ignores non-matching tag names before checkout or
dependency installation. Release titles use the normalized version without the
optional leading `v`.

## Focused Tests

Unit or integration tests should cover:

- Config validation.
- Drizzle repositories.
- Importer success and failure mapping.
- Markdown store writer.
- Highlight marker insertion.
- Highlight marker removal, shrink, and split behavior.
- Backup queue behavior.
- Backup environment failsafe drift, bootstrap, recovery, and push-failure
  behavior.
- Reader sanitization and rendering.

For backup failsafe changes, run the focused suite before broad verification:

```bash
mise exec -- bun run test tests/server/db/schema.test.ts
mise exec -- bun run test tests/server/backup/backup-environment.test.ts tests/server/backup/git-backup.test.ts tests/server/routes/api-backup-failsafe.test.ts tests/components/backup-failsafe.test.ts tests/server/backup/backup-failsafe-cli.test.ts
```

Use recovery commands in dry-run mode before applying filesystem changes:

```bash
mise exec -- bun run scripts/trauma-backup-failsafe.ts status --config trauma.config.json
mise exec -- bun run scripts/trauma-backup-failsafe.ts revert --config trauma.config.json
mise exec -- bun run scripts/trauma-backup-failsafe.ts migrate --config trauma.config.json
mise exec -- bun run scripts/trauma-backup-failsafe.ts delete-missing-record --config trauma.config.json
```

## Completion Bar

A change that affects storage, import, highlights, backup, routing, or reader
rendering should include either E2E coverage or a clear reason why focused tests
are sufficient.

Do not claim an implementation is complete without running the relevant
verification commands and recording their outcomes.

## Review Follow-Up

When a valid review finding exposes a reproducible bug, invariant gap, parser
edge case, or implementation anti-pattern, the fix should use the strongest
durable guardrail that fits:

- One-off bug: add a regression test.
- Repeated style issue: add or update linting, formatting, typecheck, or a
  static check.
- Architecture invariant: document the invariant and add a test/static check
  where possible.
- Workflow failure: update workflow automation or the workflow checklist.
- Reviewer false positive: update reviewer config, ignore rules, or reply with
  evidence.

Do not treat a prose-only documentation update as sufficient when the finding
is machine-checkable.

Review follow-up is not complete until thread-aware review state has been
checked after the fix is pushed and the corresponding review thread has a
concrete reply.
