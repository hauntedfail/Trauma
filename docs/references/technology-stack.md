# Technology Stack Reference

This reference records the selected initial stack and explicit exclusions.

## Selected Stack

- Language: TypeScript.
- Framework: SolidStart.
- UI library: Solid.
- Runtime and package manager: Bun.
- ORM: Drizzle ORM.
- Database: SQLite through Drizzle's Bun SQLite support.
- E2E testing: Playwright.

## Current Bootstrap Pins

- Bun: `1.3.13` through `mise.toml` and `packageManager`.
- SolidStart: stable v1 starter, currently `@solidjs/start@1.3.2`.
- Build runner: `vinxi`.

## Deployment Target

The app targets local operation and single-instance self-hosting on a VPS or
home server with persistent disk.

This is not a serverless-first application.

## Rationale

SolidStart keeps routing, SSR, server functions, and UI in one lightweight app.
Bun keeps the runtime/package manager surface small. SQLite and markdown files
keep operational cost low and work naturally with a single persistent disk.

Drizzle is used to keep the schema and query layer type-safe while remaining
close to SQL.

## Exclusions

Do not introduce these into the initial implementation:

- Next.js.
- PostgreSQL or managed database services.
- Redis or external job queues.
- Serverless/edge-only deployment assumptions.
- React-specific component or routing assumptions.
- Authentication/user ownership.
