# Task 04: Importer And Add Memory Workflow

## Goal

Implement the URL-only add memory flow: server-side extraction, link-only
fallback, SQLite metadata creation, markdown write, and backup enqueue boundary.

## Required Context

- [Runtime flows](../architecture/flows.md)
- [Data and storage architecture](../architecture/data-and-storage.md)
- [UI and routing architecture](../architecture/ui-and-routing.md)

## Ownership

Primary files and directories:

- `src/server/importer/**`
- `src/server/memories/**`
- Add memory route action/API files.
- `tests/server/importer/**`
- `tests/server/memories/**`

Coordinate with Task 5 for composer UI integration. Do not build the full browse
shell in this task.

## Implementation Steps

1. Define importer result types.
   - Success: title, description, favicon URL, markdown body.
   - Link-only fallback: URL, title fallback, status, error detail.

2. Implement fetch boundary.
   - Use an injectable fetch function for deterministic tests.
   - Do not persist raw HTML.

3. Implement Readability-style extraction.
   - Keep extraction behind a narrow interface so browser-assisted import can be
     added later.
   - Map insufficient article body to link-only fallback.

4. Implement add memory orchestration.
   - Generate UUID v7.
   - Create DB metadata.
   - Write `CONTENT.md` through the store API.
   - Mark extraction status and error fields.
   - Call backup enqueue through an interface, even if Task 8 later provides
     the real queue.

5. Add tests.
   - Successful fixture import.
   - Failed fetch fallback.
   - Thin body fallback.
   - Raw HTML is not written.

## Acceptance Criteria

- Add memory accepts only a URL.
- Successful extraction creates DB metadata and markdown content.
- Extraction failure still creates a link-only memory.
- The importer can be tested without real network access.
- Backup is called through a boundary, not by running git directly.

## Verification

Run:

```bash
bun run typecheck
bun run test
bun run build
```

## PR Handoff

The PR description must include:

- Importer interfaces.
- Extraction status values introduced.
- Fixture strategy.
- Exact verification commands and outcomes.
