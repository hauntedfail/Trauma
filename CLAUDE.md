# TRAUMA

Personal bookmark management app. Domain term: `memory` for one bookmark and
`memories` for the collection.

All project detail lives under `docs/`. Start at [docs/INDEX.md](docs/INDEX.md)
and read only the owning documents for the change. Open durable work is tracked
in [Backlog.md](Backlog.md).

## Common Commands

| Command | Purpose |
| --- | --- |
| `bun install` | Install dependencies |
| `bun run dev` | Start the development server |
| `bun run dev:smoke` | Verify development-server startup |
| `bun run verify` | Run typecheck, tests, and build |
| `bun run test:e2e` | Run the Playwright E2E suite |
| `bun run db:generate` / `bun run db:migrate` | Generate or apply Drizzle migrations |

Keep this file as an index. Current behavior belongs in semantic docs; completed
execution history belongs in Git.
