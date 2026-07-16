# Architecture Overview

TRAUMA is a single-user, local-first bookmark manager that can also run as one
self-hosted instance on a VPS or home server with persistent local disk.

The app is an intentional SolidStart monolith. UI, route handlers, server
functions, and server modules live in one TypeScript project to keep operation
and maintenance light.

## Runtime Shape

- One Bun application process.
- One SolidStart app.
- One SQLite database for relational runtime state.
- One file-backed memory store rooted at `storePath`.
- One in-process sequential git backup queue for selected store artifacts.
- An optional, separately operated Codex app-server for Brilliant translation
  and Psychiatrist turns.

Avoid separate API services, external queues, managed databases, or
serverless-first assumptions unless a current design explicitly changes this
shape.

## Module Boundaries

Server-side code is organized around these responsibilities:

- `config`: load and validate `trauma.config.json` and operator environment.
- `db`: Drizzle schema, migrations, and repositories over SQLite.
- `importer`: fetch public URLs and extract readable content.
- `store`: resolve, create, read, and remove memory-store artifacts.
- `backup`: validate backup identity and enqueue explicit store paths for git.
- `reader`: render untrusted Markdown through the curated reader pipeline.
- `translation`: run durable Brilliant jobs through Codex app-server.
- `psychiatrist`: run memory-scoped turns and persist thread artifacts.
- `ui shell`: shared navigation, responsive chrome, filters, popovers, and
  route-owned surfaces.

Each module exposes a narrow API. UI code does not reach into storage, backup,
importer, translation, Psychiatrist, or database internals; it uses route
loaders, actions, server functions, or domain interfaces.

## Dependency Direction

```text
UI routes and actions
  -> application and server functions
    -> domain services and repositories
      -> config | filesystem | SQLite | git | Codex app-server
```

Keep SQL inside `db`, store-path writes inside owning server modules, git
operations inside `backup`, and Codex protocol details behind their adapters.

## Explicit Non-Goals

- Next.js or React-specific routing assumptions.
- PostgreSQL or managed database services.
- Serverless or edge runtime compatibility.
- TRAUMA user accounts, sessions, public signup, or multi-user ownership.
- External queue infrastructure.
- Generic lifecycle hooks.

Codex app-server authentication used by optional backend features is not a
TRAUMA user-authentication system.
