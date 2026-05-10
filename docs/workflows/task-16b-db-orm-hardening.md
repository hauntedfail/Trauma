# Task 16b: Drizzle And SQLite Hardening Workflow

## Goal

Convert the Drizzle/Bun SQLite review findings into a focused triage subtask.
The implementation must remove deprecated Bun SQLite usage, reduce dependency
on Drizzle private internals, align CLI/runtime database config, and tighten
repository/schema safety without redesigning persistence.

## Review Basis

This workflow comes from the DB/ORM review performed against the current
`triage` branch.

Confirmed findings:

- `src/server/db/connection.ts` uses deprecated `sqlite.exec(...)`; Bun's
  current type definitions mark it as `@deprecated` and prefer `Database.run`.
- Bundled runtime migrations call `db.dialect.migrate(...)` through
  `unknown`-based private internals.
- `drizzle.config.ts` ignores `TRAUMA_CONFIG_PATH`, while runtime server code
  uses it through `loadRuntimeTraumaConfig()`.
- Repository update paths do not verify affected rows.
- Highlight offset constraints exist in TypeScript shape only, not at the
  SQLite schema boundary.

Context7 was used for the current Bun SQLite and Drizzle Bun SQLite API shape.

## Required Context

- [Drizzle and SQLite rules](../references/coding-standards/drizzle-sqlite.md)
- [Technology stack](../references/technology-stack.md)
- [Configuration reference](../references/configuration.md)
- [Data and storage architecture](../architecture/data-and-storage.md)
- [Task 16 runtime triage](task-16-red-call-runtime-triage.md)

## Ownership

Primary files:

- `src/server/db/connection.ts`
- `src/server/db/bundled-migrations.ts`
- `src/server/db/schema.ts`
- `src/server/db/repositories.ts`
- `drizzle.config.ts`
- `drizzle/**` when schema changes require generated migrations.
- `tests/server/db/schema.test.ts`
- `tests/server/config/config.test.ts`
- `tests/server/memories/add-memory.test.ts`

Optional files:

- `src/server/db/migrations.ts` if bundled migration execution needs a focused
  module separate from connection setup.
- `tests/scripts/**` only if a static guard is the cleanest way to prevent
  private migration API or deprecated Bun SQLite calls from returning.

Out of scope:

- PostgreSQL, external DBs, Redis, or job queues.
- Auth or user ownership.
- Markdown reader behavior.
- Importer extraction behavior.
- UI redesign.
- Backup queue implementation beyond repository contract safety.

## Priority Order

1. **P0: Replace deprecated Bun SQLite API**
   - Replace `sqlite.exec(...)` with `sqlite.run(...)` for PRAGMA statements.
   - Add a focused regression/static guard so `src/server/db/**` does not
     reintroduce `.exec(`.

2. **P0: Remove Drizzle private migration internals**
   - Do not cast Drizzle DB to `unknown` to call `dialect.migrate`.
   - Prefer public Drizzle `migrate(db, { migrationsFolder })` where a real
     migration folder is available.
   - For bundled runtime migrations, introduce a small tested runner that reads
     `readBundledMigrations()` and writes the standard `__drizzle_migrations`
     table using Bun SQLite `run` inside a transaction.
   - Preserve compatibility with already-created databases that have Drizzle's
     migration table.

3. **P1: Align Drizzle CLI and runtime config**
   - Make `drizzle.config.ts` honor `TRAUMA_CONFIG_PATH` through the same config
     loader contract used by runtime code.
   - Keep `TRAUMA_DATABASE_PATH` as an explicit CLI override, but document that
     it is an override.
   - Add tests or a script-level check proving `TRAUMA_CONFIG_PATH` and
     `TRAUMA_DATABASE_PATH` precedence.

4. **P1: Harden repository update semantics**
   - Make update repository methods verify affected rows.
   - `updateBackupStatus` must not return a successful result when no memory row
     was updated.
   - Add a typed domain error or explicit `undefined` result; choose the option
     that keeps current call sites simplest and unambiguous.

5. **P1: Add DB-level highlight offset constraints**
   - Add SQLite `CHECK` constraints for non-negative `start_offset` and
     `end_offset >= start_offset`.
   - Generate and commit the matching Drizzle migration.
   - Add schema tests proving invalid offsets are rejected.

6. **P2: Review connection lifecycle shape**
   - Confirm request/server-function call sites close handles in `finally`.
   - Do not introduce a process-wide singleton in this task unless profiling or
     lock evidence shows repeated open/migrate is causing runtime failures.
   - If repeated migration work remains costly, add a follow-up workflow rather
     than hiding a global mutable connection in this PR.

## Implementation Strategy

### Phase 1: Low-risk API cleanup

- Replace the two PRAGMA calls in `initializeDatabase()` with `sqlite.run`.
- Keep PRAGMA order unchanged: foreign keys first, WAL second.
- Add a test/guard that fails on `.exec(` inside `src/server/db`.
- Run the existing DB schema test before continuing.

### Phase 2: Migration boundary hardening

- Split migration execution out of `connection.ts` if needed.
- Keep `initializeDatabase()` responsible for orchestration only:
  - create directory
  - open Bun SQLite database
  - apply PRAGMAs
  - create Drizzle database
  - apply migrations
  - create repositories
  - close on initialization failure
- Keep migration data owned by `bundled-migrations.ts`.
- Remove `BunMigrationDatabaseInternals` and any `unknown` cast used only to
  reach Drizzle internals.
- Add tests that initialize from bundled migrations and from an explicit
  `migrationsFolder`.
- Keep the existing drift test comparing bundled migrations with `drizzle/**`.

### Phase 3: Config contract alignment

- Update `drizzle.config.ts` resolution order:
  1. `TRAUMA_DATABASE_PATH`
  2. `TRAUMA_CONFIG_PATH`
  3. cwd `trauma.config.json`
  4. default `./.trauma/trauma.sqlite`
- Ensure relative database paths still resolve exactly as
  `loadTraumaConfig()` defines them.
- Add focused coverage for the new precedence.

### Phase 4: Repository and schema safety

- Make `updateBackupStatus` prove a row was updated.
- Add tests for missing-memory backup status updates.
- Add highlight offset constraints to `schema.ts`.
- Generate migration SQL with `bun run db:generate`.
- Review generated SQL before committing.
- Add a Bun subprocess schema test that attempts an invalid highlight insert
  and expects SQLite to reject it.

### Phase 5: Documentation and standards sync

- Update [Drizzle and SQLite rules](../references/coding-standards/drizzle-sqlite.md)
  only if the implementation establishes a reusable rule that is not already
  documented.
- Do not expand `AGENTS.md`; it is only a map.
- If a static guard is added, document it in [Verification](../quality/verification.md)
  only when future workers need to run it directly.

## Acceptance Criteria

- No production DB code under `src/server/db/**` calls deprecated
  `sqlite.exec(...)`.
- Runtime bundled migrations no longer call Drizzle private internals through
  `unknown` casts.
- Existing databases with `__drizzle_migrations` continue to initialize.
- `drizzle.config.ts` and runtime server code agree on `TRAUMA_CONFIG_PATH`.
- `TRAUMA_DATABASE_PATH` remains a documented explicit CLI override.
- `updateBackupStatus` cannot silently report success for a missing memory row.
- Highlight offsets are protected by SQLite `CHECK` constraints and tests.
- Schema changes include committed Drizzle migration SQL and metadata.
- `bun run verify` passes.

## Verification Commands

Run from the implementation branch:

```bash
mise exec -- bun run typecheck
mise exec -- bun run test tests/server/db/schema.test.ts
mise exec -- bun run test tests/server/config/config.test.ts
mise exec -- bun run test tests/server/memories/add-memory.test.ts
mise exec -- bun run verify
```

Run E2E only if connection lifecycle changes affect runtime startup or route
behavior:

```bash
mise exec -- bun run test:e2e
mise exec -- bun run dev:smoke
```

## Branching And PR Flow

Start from `triage`:

```bash
git switch triage
git pull --ff-only origin triage
git switch -c triage-db-orm-hardening
```

Open the PR against `triage`. If `triage` lands into `main` first, rebase onto
`main` and retarget the PR.

## PR Handoff

The PR description must include:

- Deprecated Bun SQLite API replacements.
- Migration boundary chosen and why it does not depend on Drizzle private
  internals.
- Config precedence for `TRAUMA_DATABASE_PATH` and `TRAUMA_CONFIG_PATH`.
- Repository update behavior for missing rows.
- Migration file names when schema constraints change.
- Exact verification commands and outcomes.
