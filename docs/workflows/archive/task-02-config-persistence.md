# Task 02: Config And Persistence Workflow

## Status

Archived. Merged through pull request #1.

## Goal

Implement the configuration loader, path validation, Drizzle SQLite schema, and
repository foundation used by all feature domains.

## Required Context

- [Configuration reference](../../references/configuration.md)
- [Data and storage architecture](../../architecture/data-and-storage.md)
- [Architecture overview](../../architecture/overview.md)
- [Verification strategy](../../quality/verification.md)

## Ownership

Primary files and directories:

- `src/server/config/**`
- `src/server/db/**`
- `drizzle.config.ts`
- `drizzle/**`
- `tests/server/config/**`
- `tests/server/db/**`

Avoid changing UI routes except when a failing compile requires a public type
export adjustment.

## Implementation Steps

1. Create typed config contracts.
   - Define `TraumaConfig`, `GitBackupConfig`, and validation result types.
   - Keep config JSON-only. Do not add executable config.

2. Implement config loading.
   - Default lookup: `trauma.config.json` in project root.
   - Allow an explicit path for tests.
   - Provide clear startup errors for missing file, invalid JSON, and invalid
     shape.

3. Implement path validation.
   - Resolve `projectPath`, `storePath`, and `databasePath` to absolute paths.
   - Enforce `storePath` inside `projectPath`.
   - Ensure `databasePath` is outside the git backup target.

4. Define Drizzle schema.
   - Tables: `memories`, `tags`, `categories`, `memory_tags`,
     `memory_categories`, `highlights`.
   - Use UUID v7-compatible text IDs.
   - Add timestamps to all core tables.

5. Add repository entrypoints.
   - Create DB initialization from resolved config.
   - Export typed repository helpers for future tasks.
   - Keep SQL details inside `src/server/db/**`.

6. Add tests before implementation behavior is considered complete.
   - Valid config loads and resolves paths.
   - Invalid JSON fails clearly.
   - `storePath` outside `projectPath` fails.
   - Schema module loads and repository initialization can open a temporary
     SQLite database.

## Acceptance Criteria

- `trauma.config.json` can be loaded and validated.
- Invalid config/path relationships fail before app behavior starts.
- Drizzle schema contains all foundation tables.
- Tests use temporary directories and do not write runtime state into the repo.
- Public exports are stable enough for Tasks 3-8.

## Verification

Run:

```bash
bun run typecheck
bun run test
bun run db:generate
bun run build
```

## PR Handoff

The PR description must include:

- Config keys implemented.
- Schema tables added.
- Migration files created.
- Exact verification commands and outcomes.
- Any repository API names future workers should use.
