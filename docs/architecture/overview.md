# Architecture Overview

Trauma is a single-user, local-first bookmark management app that can also run
on a single VPS or home server with persistent local disk.

The app uses a SolidStart monolith: UI, route handlers, server functions, and
server modules live in one TypeScript project. The monolith is intentional. The
project is a sub-project and should stay light to operate.

## Runtime Shape

- One Bun process.
- One SolidStart app.
- One SQLite metadata database.
- One markdown store rooted at `storePath`.
- One built-in git backup queue for markdown content.

Avoid introducing separate API services, external queues, managed databases, or
serverless-first assumptions unless a later design explicitly changes the
foundation.

## Module Boundaries

Server-side code should be organized around these responsibilities:

- `config`: load and validate `trauma.config.json`.
- `db`: Drizzle schema and repository functions over SQLite.
- `importer`: fetch URLs and extract readable content.
- `store`: create and read memory markdown files.
- `backup`: enqueue and run built-in git backup work.
- `reader`: render markdown through the curated reader pipeline.
- `ui shell`: route-level layouts, navigation, filters, composer, and reader UI.

Each module should expose a narrow API. UI code should not reach into storage,
backup, or importer internals directly; it should call route loaders, server
functions, or repository-level interfaces.

## Dependency Direction

Preferred dependency direction:

```text
UI routes/actions
  -> application/server functions
    -> importer | store | backup | reader | db repositories
      -> config | filesystem | SQLite | git
```

Keep filesystem writes inside `store` and git operations inside `backup`.
Keep SQL details inside `db`.

## Explicit Non-Goals

- Next.js.
- PostgreSQL in the initial implementation.
- Serverless or edge runtime compatibility.
- Authentication or user ownership.
- External queue infrastructure.
- Generic lifecycle hooks.
