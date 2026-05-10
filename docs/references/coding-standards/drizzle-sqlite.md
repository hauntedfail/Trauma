# Drizzle And SQLite Rules

## Server And Persistence Boundaries

- MUST keep Drizzle access inside server-side persistence modules.
- MUST NOT query SQLite directly from route components or client code.
- MUST use parameterized Drizzle/SQL APIs. Never interpolate user input into SQL.
- MUST use Drizzle's `sql` tagged template for custom SQL expressions. Use
  `sql.raw()` only for static, locally defined SQL fragments.
- MUST keep `src/server/db/schema.ts` as the codebase-first schema source of
  truth.
- MUST commit schema changes with matching migrations and metadata.
- MUST derive persisted status constraints from the same domain constants used
  by TypeScript unions and validators, or add a focused drift test.
- MUST use `bun run db:generate` and review the generated SQL for schema
  changes. Do not use push-style schema mutation for reviewable project
  migrations.
- MUST NOT edit an already-applied migration to change its behavior. Add a
  forward migration instead, because runtime migration hashes are compatibility
  guards for existing local SQLite databases.
- MUST define both database-level constraints and Drizzle relations when a table
  relationship is part of the domain model.
- MUST wrap multi-table or multi-step writes in transactions. Memory creation,
  tag/category association, highlight persistence, and backup status updates
  must not partially commit.
- MUST make post-insert boundary failures recoverable for create workflows.
  After a memory row and `CONTENT.md` are durable, backup enqueue/status failures
  must return the created memory with the best persisted status or compensate
  explicitly instead of surfacing an ambiguous failed create.
- MUST apply bundled migrations before exposing repositories or returning an
  initialized database handle to application code.
- MUST use current Bun SQLite APIs. Use `Database.run`, prepared statements, or
  Drizzle queries instead of deprecated `Database.exec`.
- MUST close the SQLite handle if initialization fails after the handle is
  opened.
- MUST keep SQLite database files outside the markdown backup store.
- MUST resolve and validate configured paths before filesystem writes.
- MUST prevent path traversal when reading or writing markdown content.
- MUST resolve bundled migration paths from module/package location or an
  explicit option, not from incidental launch cwd.
- MUST keep bundled runtime migrations in sync with reviewable `drizzle/**`
  migration files through a focused drift test.
- MUST use SQLite-native migration metadata schema. Any local
  `__drizzle_migrations` table must use a rowid-compatible integer primary key,
  not PostgreSQL-style `SERIAL`.
- MUST validate bundled runtime migration state before exposing the database.
  Every applied migration row must correspond to a bundled migration, and every
  matching row must have the expected hash. Unknown, newer, or hash-mismatched
  rows must fail loudly instead of letting older runtime code operate on a
  different schema.
- MUST treat migration execution and migration recording as one atomic unit.
  If a migration body succeeds but writing `__drizzle_migrations` fails, the
  schema changes must roll back with the failed record write.
- MUST keep SQLite PRAGMA exceptions narrow. When generated migrations need
  `PRAGMA foreign_keys=OFF/ON`, apply only the PRAGMA state transition outside
  the active transaction; keep ordinary DDL/DML and the migration record inside
  a rollback-capable transaction.
- MUST validate foreign key integrity before recording a bundled migration.
  Table rebuilds that temporarily disable FK enforcement must not silently carry
  orphan rows forward; run `PRAGMA foreign_key_check` or an equivalent typed
  integrity check and fail loudly before writing the migration record.
- MUST keep every runtime migration entrypoint semantically equivalent. Test,
  explicit-folder, and bundled paths must honor the same PRAGMA, hash, atomicity,
  and compatibility rules, or the weaker entrypoint must be removed.
- MUST route explicit migration folders through Trauma's checked runtime runner.
  Drizzle may parse committed migration files, but it must not own runtime
  migration application semantics for this app.
- MUST keep Trauma's runtime migration data contract locally owned. Do not type
  production runner inputs against Drizzle migrator metadata interfaces.
- MUST NOT call Drizzle private migration internals such as `dialect.migrate`
  through `unknown` casts. Runtime migrations must use public APIs or a focused
  local runner with tests.
- MUST lazy-load optional migration helpers only inside the branch that uses
  them. The default startup path must not import adapter tooling that is
  unnecessary for bundled runtime migrations.
- MUST keep `drizzle.config.ts`, runtime config, migrations, and tests pointed
  at the same database path contract.
- MUST use actual Bun SQLite driver types for Bun-backed connections. Do not
  cast unrelated sqlite adapters into Bun/Drizzle compatibility.
- MUST store highlights as non-empty text ranges. Use `end_offset >
  start_offset` for highlight rows; if zero-width anchors are later needed,
  model them as a separate domain concept instead of overloading highlights.
- MUST justify indexes by query shape and constraint ownership. FK child-key
  indexes are valid for relationship enforcement and cascade performance; avoid
  speculative single-column or composite indexes that are not tied to repository
  queries.
- SHOULD expose repository methods that match domain use cases rather than
  generic table access.
- AVOID adding external services, queues, managed databases, or auth/user
  ownership unless a later design explicitly adds them.
