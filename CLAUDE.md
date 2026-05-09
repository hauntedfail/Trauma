# Trauma

Personal bookmark management app. Domain term: `memory` (one bookmark), `memories` (collection).

Stack: TypeScript / SolidStart / Bun / Drizzle / SQLite / Vitest / Playwright.

## Documentation

All project detail lives under `docs/`. Start at [docs/INDEX.md](docs/INDEX.md).

### Architecture
- [Overview](docs/architecture/overview.md)
- [Data and storage](docs/architecture/data-and-storage.md)
- [Runtime flows](docs/architecture/flows.md)
- [UI and routing](docs/architecture/ui-and-routing.md)

### References
- [Technology stack](docs/references/technology-stack.md)
- [Configuration](docs/references/configuration.md)
- [Coding standards](docs/references/coding-standards/INDEX.md)
- [Glossary](docs/references/glossary.md)

### Operations / Quality
- [Local self-hosting](docs/operations/local-self-hosting.md)
- [Verification](docs/quality/verification.md)

### Workflows / Spec
- [Execution workflows](docs/workflows/README.md)
- [Foundation design](docs/superpowers/specs/2026-05-09-trauma-foundation-design.md)

## Common Commands

| Command | Purpose |
|---------|---------|
| `bun install` | Install deps |
| `bun run dev` | Dev server |
| `bun run verify` | typecheck + test + build |
| `bun run test:e2e` | Playwright smoke |
| `bun run db:generate` / `db:migrate` | Drizzle schema |

## Rules

- CLAUDE.md = index only. Detail belongs in `docs/`.
- Keep `AGENTS.md` and this file aligned as short maps, not design docs.
- Update foundation spec only when an approved foundation decision changes.
