# Local And Self-Hosted Operation

Trauma is designed for local use first, with a clean path to single-instance
self-hosting.

## Operating Model

Expected runtime:

- One Bun process.
- One SolidStart app.
- One SQLite database file.
- One markdown store on persistent disk.
- Optional git remote for markdown backup.

The initial deployment target is a local machine, VPS, or home server. The
server must have persistent disk access.

## Data Ownership

SQLite owns runtime metadata.

The markdown store owns readable memory content and is the only content area
covered by built-in git backup.

The SQLite database file should be protected by normal host backup strategy if
needed. Trauma's built-in git backup does not commit the database file.

## Git Backup

Built-in backup commits markdown store changes from `storePath` using
`projectPath` as the git working directory.

Backup work is asynchronous. A failed backup does not invalidate memory
creation, highlight creation, or markdown writes. Failures are recorded and
surfaced through metadata.

## Local Dev Server Contract

The dev server uses deterministic host and port settings to avoid random-port
discovery failures. All settings come from the project root `.env` file
(loaded automatically by Bun for `bun run` scripts). `.env.example` ships
the safe defaults; copy it to `.env` once before running anything.

Defaults from `.env.example`:

- `HOST=127.0.0.1` (loopback only)
- `PORT=3000`
- `TRAUMA_HMR_PORT=24678` (client; server uses base+1, server-function
  uses base+2)

The shell environment wins over `.env`. Exporting `HOST=0.0.0.0` in the
shell will override the loopback default, which is intentional for cases
where the operator wants network exposure behind their own firewall or
reverse proxy. Set explicit values in `.env` for the no-auth local model.

Smoke-only overrides:

- `TRAUMA_DEV_HOST` — host the smoke check probes (falls back to `HOST`,
  then `127.0.0.1`).
- `TRAUMA_DEV_PORT` — port the smoke check probes (falls back to `PORT`,
  then `3000`).

Standard commands:

- `bun run dev` — start the dev server using `HOST` and `PORT` from `.env`.
- `bun run dev:smoke` — boot the dev server, probe `/memories`, then exit.
  Fails if the requested port is occupied, the server cannot bind, exits
  early, falls back to a different port, or does not respond within the
  timeout.
- `bun run start` — serve the production build using `HOST` and `PORT`
  from `.env`. With the default `HOST=127.0.0.1` the Vinxi CLI binds
  loopback only; without an explicit `HOST` the CLI would default to
  `0.0.0.0`.

The smoke check sets `TRAUMA_BROWSE_FIXTURES=1` so it does not depend on a
real `trauma.config.json`. Run the smoke check before relying on the dev
server in CI or scripted environments.

`bun run test:e2e` boots its own dev server with explicit `HOST=127.0.0.1`,
`PORT=4173`, and `TRAUMA_HMR_PORT=24681`, so it can run alongside
`bun run dev` without HMR port collisions and is unaffected by `.env`.

## Auth

There is no auth in the initial operating model. The app is single-user and
should be deployed behind local access controls, private networking, or a
reverse proxy policy if exposed.

Future public/team operation requires a separate auth design.
