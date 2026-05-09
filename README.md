# Trauma

Trauma is a personal bookmark management app. The product language uses
`memory` for one saved bookmark and `memories` for the collection.

The project is designed as a lightweight local/self-hosted web app: one
SolidStart app, one Bun runtime, SQLite for metadata, markdown files for saved
content, and git backup for the markdown store.

## Status

Foundation/bootstrap stage. The app currently has the SolidStart/Bun toolchain,
baseline routes, test configuration, Drizzle configuration, and documentation
structure needed for feature work.

## Stack

- TypeScript
- SolidStart / Solid
- Bun
- Drizzle ORM
- SQLite
- Playwright
- Vitest

Pinned bootstrap versions are documented in
[docs/references/technology-stack.md](docs/references/technology-stack.md).

## Local Development

Install dependencies:

```bash
bun install
```

Run the dev server:

```bash
bun run dev
```

Run baseline verification:

```bash
bun run verify
```

Run E2E smoke tests:

```bash
bun run test:e2e
```

## Documentation

Start with [docs/INDEX.md](docs/INDEX.md).

Key references:

- [Foundation design](docs/superpowers/specs/2026-05-09-trauma-foundation-design.md)
- [Task execution workflows](docs/workflows/README.md)
- [Architecture overview](docs/architecture/overview.md)
- [Data and storage](docs/architecture/data-and-storage.md)
- [Runtime flows](docs/architecture/flows.md)
- [UI and routing](docs/architecture/ui-and-routing.md)
- [Configuration](docs/references/configuration.md)
- [Verification strategy](docs/quality/verification.md)

## Initial Scope

Trauma is initially single-user and local/self-hosted. Auth, public signup,
managed databases, external queues, serverless deployment, and full offline
archival are out of scope for the foundation.
