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
- MUST use `bun run db:generate` and review the generated SQL for schema
  changes. Do not use push-style schema mutation for reviewable project
  migrations.
- MUST define both database-level constraints and Drizzle relations when a table
  relationship is part of the domain model.
- MUST wrap multi-table or multi-step writes in transactions. Memory creation,
  tag/category association, highlight persistence, and backup status updates
  must not partially commit.
- MUST keep SQLite database files outside the markdown backup store.
- MUST resolve and validate configured paths before filesystem writes.
- MUST prevent path traversal when reading or writing markdown content.
- SHOULD expose repository methods that match domain use cases rather than
  generic table access.
- AVOID adding external services, queues, managed databases, or auth/user
  ownership unless a later design explicitly adds them.
