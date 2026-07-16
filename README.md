<div align="center">
    <p align="center">
        <img width="100" height="100" src="https://github.com/user-attachments/assets/13d12204-e86b-413a-822e-60dc9ef649c8" alt="Trauma Logo"/>
    </p>
    <h1>TRAUMA</h1>
    <br/>
    <p>TRAUMA is a personal bookmark management app. The product language uses
`memory` for one saved bookmark and `memories` for the collection.</p>
    <br/>
</div>

> <span style="color: #b7791f;">⚠️ Warning:</span> This is mostly a personal
> project that I work on in the margins of another project, so please do not
> expect particularly eager maintenance.

The project is a lightweight local/self-hosted web app: one SolidStart app, one
Bun runtime, SQLite for relational state, a file-backed memory store for reader
content and Psychiatrist threads, and built-in git backup for selected store
artifacts.

## Status

The current baseline includes URL and browser-assisted import, memory browsing
and read state, source and translated readers, Flashbacks, Moments, Brilliant
translation, the memory-scoped Psychiatrist assistant, settings, responsive
shells, and backup failsafe recovery. See [docs/INDEX.md](docs/INDEX.md) for the
current implementation contracts.

## Previews

| Sun Light | Sun Paper |
| --- | --- |
| <img width="540" alt="TRAUMA Sun Light theme" src="https://github.com/user-attachments/assets/e511eafb-9509-43ea-9020-9cf7e63d72fa" /> | <img width="540" alt="TRAUMA Sun Paper theme" src="https://github.com/user-attachments/assets/951925b4-d274-4e45-9c40-00d6e29ac76a" /> |

| Night Midnight | Night Hermès |
| --- | --- |
| <img width="540" alt="TRAUMA Night Midnight theme" src="https://github.com/user-attachments/assets/02f45a5f-a8b6-47bf-80c5-3ce019e41c87" /> | <img width="540" alt="TRAUMA Night Hermès theme" src="https://github.com/user-attachments/assets/94f0b53f-da17-485a-a4da-a8857d7da94d" /> |

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

Run the Playwright E2E suite:

```bash
bun run test:e2e
```

## Documentation

Start with [docs/INDEX.md](docs/INDEX.md). Open durable work is listed in
[Backlog.md](Backlog.md); completed execution history is retained by Git rather
than duplicated in agent-facing documentation.

## Operating Scope

TRAUMA is single-user and local/self-hosted. TRAUMA user accounts, sessions,
multi-user ownership, public signup, managed databases, external queues,
serverless deployment, and full offline archival are out of scope. Optional
Codex app-server authentication for Brilliant and Psychiatrist is a separate
backend integration documented in the
[configuration reference](docs/references/configuration.md#codex-app-server-environment).
