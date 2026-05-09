# Task 07: Highlight System Workflow

## Goal

Implement text selection highlights in reader mode, with optimistic UI, SQLite
persistence, and `<mark data-highlight-id>` insertion into `CONTENT.md`.

## Required Context

- [Data and storage architecture](../architecture/data-and-storage.md)
- [Runtime flows](../architecture/flows.md)
- [UI and routing architecture](../architecture/ui-and-routing.md)

## Ownership

Primary files and directories:

- `src/components/reader/**`
- `src/server/highlights/**`
- `src/server/store/**` highlight insertion helpers.
- `src/server/db/**` highlight repository helpers.
- `tests/server/highlights/**`
- Highlight-focused E2E specs.

Avoid changing the reader pipeline except where needed to surface highlight UI.

## Implementation Steps

1. Define highlight contract.
   - `id`
   - `memory_id`
   - `text`
   - `prefix`
   - `suffix`
   - `start_offset`
   - `end_offset`

2. Implement selection capture.
   - Capture selected text.
   - Capture prefix/suffix context.
   - Capture offsets against normalized reader text.

3. Implement optimistic UI.
   - Show highlight immediately.
   - Disable duplicate submission for the active selection.
   - Roll back or mark failed when persistence fails.

4. Implement server persistence.
   - Insert highlight row.
   - Insert `<mark data-highlight-id="...">selected text</mark>` into
     `CONTENT.md`.
   - Enqueue backup through the Task 8 boundary.

5. Add tests.
   - Same text appearing multiple times anchors correctly using hybrid selector.
   - Mark insertion preserves markdown outside the selection.
   - Failed persistence reports failure to the UI.

6. Add E2E coverage.
   - Select text in `/memories/:id`.
   - Verify highlight appears.
   - Reload and verify persisted highlight appears.

## Acceptance Criteria

- Reader remains non-editable except for highlight creation.
- Highlight records are canonical in SQLite.
- `CONTENT.md` stores persisted mark tags.
- Existing sanitization allows the persisted marks.
- Backup enqueue happens after markdown write.

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

- Selection anchoring strategy.
- Failure/rollback behavior.
- Mark insertion examples.
- Exact verification commands and outcomes.
