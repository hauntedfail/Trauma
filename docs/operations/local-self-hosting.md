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
discovery failures.

Defaults:

- Host: `localhost` (loopback only — matches both `127.0.0.1` and `::1`)
- App port: `3000`
- HMR ports: `24678` (client), `24679` (server), `24680` (server-function)

Override via environment:

- `TRAUMA_DEV_HOST` — host used by the smoke check.
- `TRAUMA_DEV_PORT` — app port used by the smoke check.
- `TRAUMA_HMR_PORT` — base HMR port. Server and server-function routers use
  the next two ports above this value.

Standard commands:

- `bun run dev` — start the dev server on port `3000`.
- `bun run dev:smoke` — boot the dev server, probe `/memories`, then exit.
  Fails if the requested port is occupied, the server cannot bind, exits
  early, falls back to a different port, or does not respond within the
  timeout.
- `bun run start` — serve the production build bound to `127.0.0.1:3000`
  (loopback only). Override the bind address by passing `--host` directly
  to `vinxi start`. Without `--host` the underlying Vinxi CLI defaults to
  `0.0.0.0`, which is why this script pins it explicitly.

The smoke check sets `TRAUMA_BROWSE_FIXTURES=1` so it does not depend on a
real `trauma.config.json`. Run the smoke check before relying on the dev
server in CI or scripted environments.

`bun run test:e2e` boots its own dev server on port `4173` and pins
`TRAUMA_HMR_PORT=24681` so it can run alongside `bun run dev` without HMR
port collisions.

## Auth

There is no auth in the initial operating model. The app is single-user and
should be deployed behind local access controls, private networking, or a
reverse proxy policy if exposed.

Future public/team operation requires a separate auth design.
