# Local And Self-Hosted Operation

TRAUMA is designed for local use first, with a clean path to single-instance
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
needed. TRAUMA's built-in git backup does not commit the database file.

## Git Backup

Built-in backup commits markdown store changes from `storePath` using
`projectPath` as the git working directory.

`projectPath` is expected to be the backup repository root. For the default
local setup, use `projectPath: "./data"` and `storePath: "./data/storage"`.
TRAUMA treats `./data` as separate from the application repository.

On a clean first start with git backup enabled, TRAUMA creates `projectPath`,
creates `storePath`, and initializes a git repository under `projectPath` when
one does not already exist. If memory rows or `CONTENT.md` files already exist,
TRAUMA does not auto-initialize a new repository. It creates a critical failsafe
alert so the operator can choose `revert` or `migrate` explicitly.

Backup work is asynchronous. A failed backup does not invalidate memory
creation, highlight creation, or markdown writes. Failures are recorded and
surfaced through metadata.

When push is enabled, a missing configured remote name is treated as local-only
backup and does not warn. A configured remote that exists but fails to push
creates a critical alert while keeping the local commit.

If SQLite records successful backup content but the corresponding `CONTENT.md`
is missing, outside the configured paths, or untracked, TRAUMA reports a backup
content-integrity alert. This is not a backup location change. The web UI and
CLI offer deletion only for the `missing_file` case, and only after re-checking
that the file is still absent. Untracked or out-of-scope content must be repaired
as backup repository/path state so existing markdown is not discarded.

## Local Dev Server Contract

The dev server uses the project root `.env` file only for the small set of
operator settings documented in `.env.example`. Keep normal local configuration
minimal; one-off host, port, HMR, smoke, and CI overrides should be supplied by
the shell or the command that needs them.

Standard commands:

- `bun run dev` — start the dev server.
- `bun run dev:smoke` — boot the dev server, probe `/memories`, then exit.
  Fails if the requested port is occupied, the server cannot bind, exits
  early, falls back to a different port, or does not respond within the
  timeout.
- `bun run start` — serve the production build.

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
