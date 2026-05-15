# TRAUMA

TRAUMA is a personal bookmark management app. The product language uses
`memory` for one saved bookmark and `memories` for the collection.

> <span style="color: #b7791f;">⚠️ Warning:</span> This is mostly a personal
> project that I work on in the margins of another project, so please do not
> expect particularly eager maintenance.

The project is designed as a lightweight local/self-hosted web app: one
SolidStart app, one Bun runtime, SQLite for metadata, markdown files for saved
content, and git backup for the markdown store.

## Status

The foundation implementation is now more than scaffold. The current baseline
includes SolidStart/Bun runtime commands, Drizzle/SQLite persistence, markdown
content storage, add-memory import, memory browsing, reader routes, highlights,
git backup, backup failsafe recovery, Defuddle-based extraction, Tailwind
styling, and the local browser-assisted import extension.

Some workflow documents remain as implementation records or future hardening
plans. Treat [docs/workflows/README.md](docs/workflows/README.md) as the
current map before starting new work.

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

Create the local environment file from the example:

```bash
cp .env.example .env
```

`.env` is gitignored. Keep it for local TRAUMA settings such as browser import.
The `dev`, `start`, and `preview` scripts default `HOST` to `127.0.0.1` unless
you set another host in the shell.

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

## Proves

| Sun Light | Sun Paper |
| --- | --- |
| <img width="540" alt="TRAUMA Sun Light theme" src="https://github.com/user-attachments/assets/e511eafb-9509-43ea-9020-9cf7e63d72fa" /> | <img width="540" alt="TRAUMA Sun Paper theme" src="https://github.com/user-attachments/assets/951925b4-d274-4e45-9c40-00d6e29ac76a" /> |

| Night Midnight | Night Hermès |
| --- | --- |
| <img width="540" alt="TRAUMA Night Midnight theme" src="https://github.com/user-attachments/assets/02f45a5f-a8b6-47bf-80c5-3ce019e41c87" /> | <img width="540" alt="TRAUMA Night Hermès theme" src="https://github.com/user-attachments/assets/94f0b53f-da17-485a-a4da-a8857d7da94d" /> |

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

TRAUMA is initially single-user and local/self-hosted. Auth, public signup,
managed databases, external queues, serverless deployment, and full offline
archival are out of scope for the foundation.
