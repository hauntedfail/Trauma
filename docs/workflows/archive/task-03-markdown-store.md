# Task 03: Markdown Store Workflow

Status: archived after completion.

## Goal

Implement the filesystem contract for readable memory content:
`{storePath}/memories/{memoryId}/CONTENT.md`.

## Required Context

- [Data and storage architecture](../../architecture/data-and-storage.md)
- [Runtime flows](../../architecture/flows.md)
- [Configuration reference](../../references/configuration.md)

## Ownership

Primary files and directories:

- `src/server/store/**`
- `tests/server/store/**`
- Store-related shared types under `src/server/**`

Do not implement URL importing, reader rendering, or git backup in this task.

## Implementation Steps

1. Define store contracts.
   - `MemoryContentFrontmatter`
   - `WriteMemoryContentInput`
   - `ReadMemoryContentResult`
   - A content path resolver that accepts resolved config and `memoryId`.

2. Write frontmatter serialization.
   - Required keys: `id`, `url`, `title`, `captured_at`,
     `extraction_status`.
   - Keep tags and categories out of frontmatter.

3. Implement content writing.
   - Create `memories/{memoryId}` if it does not exist.
   - Write `CONTENT.md` atomically enough for local operation.
   - Return the relative content path for DB persistence.

4. Implement content reading.
   - Read `CONTENT.md`.
   - Parse frontmatter and markdown body.
   - Fail clearly when the file is missing or malformed.

5. Add filesystem-isolated tests.
   - Use temporary directories.
   - Verify path structure.
   - Verify frontmatter roundtrip.
   - Verify remote image links are not downloaded or rewritten.

## Acceptance Criteria

- The store writer creates the exact directory/file layout.
- The store reader returns parsed metadata and markdown body.
- Tests do not touch `data/` or `.trauma/` in the repository.
- No importer, reader, or backup logic leaks into `src/server/store/**`.

## Verification

Run:

```bash
bun run typecheck
bun run test
bun run build
```

## PR Handoff

The PR description must include:

- The writer/reader API names.
- A sample generated `CONTENT.md`.
- Exact verification commands and outcomes.
- Any assumptions Task 4 and Task 6 must preserve.
