# Task 06: Reader Pipeline Workflow

## Goal

Implement `/memories/:id` read mode and the curated markdown rendering pipeline.

## Required Context

- [UI and routing architecture](../architecture/ui-and-routing.md)
- [Data and storage architecture](../architecture/data-and-storage.md)
- [Verification strategy](../quality/verification.md)

## Ownership

Primary files and directories:

- `src/routes/memories/[id].tsx`
- `src/server/reader/**`
- `src/components/reader/**`
- `tests/server/reader/**`
- Reader-focused E2E fixtures.

Do not implement highlight creation in this task. The reader must only preserve
already persisted `<mark data-highlight-id>` markers.

## Implementation Steps

1. Add reader route.
   - Canonical path: `/memories/:id`.
   - Load metadata from repository interfaces.
   - Load `CONTENT.md` through the store reader.

2. Build markdown pipeline.
   - GitHub Flavored Markdown.
   - Syntax highlighting.
   - Footnotes.
   - Heading anchors.
   - Table of contents.
   - Controlled external embeds.
   - Sanitization.

3. Preserve highlight marks.
   - Allow `mark`.
   - Allow `data-highlight-id`.
   - Reject scripts and unsafe HTML attributes.

4. Add tests.
   - Markdown renders headings, links, lists, code, and tables.
   - Unsafe HTML is removed.
   - Existing highlight marks survive sanitization.
   - Missing memory/content fails with a user-readable state.

5. Add E2E smoke.
   - Use a fixture memory and fixture `CONTENT.md`.
   - Visit `/memories/:id`.
   - Verify title, ToC/anchor behavior, and rendered content.

## Acceptance Criteria

- `/memories/:id` reads from the store contract.
- The reader is not an editor.
- Curated markdown features are implemented and tested.
- Sanitization is explicit and covered by tests.

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

- Markdown libraries chosen.
- Sanitization allowlist.
- Fixture memory used for E2E.
- Exact verification commands and outcomes.
