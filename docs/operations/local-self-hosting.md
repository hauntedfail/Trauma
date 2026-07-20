# Local And Self-Hosted Operation

TRAUMA is designed for local use first, with a clean path to single-instance
self-hosting.

## Operating Model

Expected runtime:

- One Bun process.
- One SolidStart app.
- One SQLite database file.
- One memory artifact store on persistent disk.
- Optional git remote for built-in store backup.

The deployment target is a local machine, VPS, or home server. The
server must have persistent disk access.

TRAUMA enforces the one-process operating model before a request can open
runtime storage. One lease owns the complete effective database, artifact
store, and backup project root set for the Bun process lifetime. Overlapping
paths, symlinks, and hardlinks contend; disjoint sibling trees remain
independent. A conflict reports the recorded owner PID and roots. Stop the
active owner instead of deleting lease state.

The stable coordinator lives at
`<OS-account-home>/.local/state/trauma/runtime-leases/coordinator.sqlite`,
outside application data and built-in backup. Do not version, copy, or delete
it while TRAUMA or a maintenance command is running. Crash-stale state is
cleaned automatically by the next owner. If startup reports an unsupported
coordinator schema, stop every TRAUMA process and maintenance command, verify
none remains, move the `runtime-leases` directory aside, and start the current
version again.

Coordination covers processes under the same OS account on one host filesystem
namespace. Separate hosts, UIDs, or containers do not share it, and unusual
FUSE or bind-mount aliases are outside the guarantee. Run one TRAUMA process or
container, enforce a single replica, and do not overlap maintenance jobs.

## Data Ownership

Canonical ownership is defined by the
[data and storage matrix](../architecture/data-and-storage.md#ownership-matrix).
SQLite and the file-backed store each own specific domains. Built-in git backup
covers only explicitly enqueued artifacts under `storePath`.

The SQLite database file should be protected by normal host backup strategy if
needed. TRAUMA's built-in git backup does not commit the database file.

## Git Backup

Built-in backup commits explicitly enqueued store artifacts from `storePath`
using `projectPath` as the git working directory.

TRAUMA disables ambient Git hooks for all built-in repository commands by
overriding `core.hooksPath` with the operating system's null device. Repository
or global `pre-commit`, `commit-msg`, `post-commit`, and `pre-push` hooks are not
part of the backup contract and do not run during normal backup, retry, startup
recovery, or failsafe migration.

`projectPath` is expected to be the backup repository root. For the default
local setup, use `projectPath: "./data"` and `storePath: "./data/storage"`.
TRAUMA treats `./data` as separate from the application repository.

On a clean first start with git backup enabled, TRAUMA creates `projectPath`,
creates `storePath`, and initializes a git repository under `projectPath` when
one does not already exist. If memory rows or source `CONTENT.md` files already
exist, TRAUMA does not auto-initialize a new repository. It creates a critical
failsafe
alert so the operator can choose `revert` or `migrate` explicitly.

Backup work is asynchronous. A failed backup does not invalidate memory or
Flashback creation, a completed translation, a saved Psychiatrist answer, or
other durable store writes. Failures are recorded and surfaced through metadata.
Flashback export reconciliation is separate from git: startup replays retained
export intents from SQLite even when git backup is disabled or its failsafe is
active. Translation completion also republishes the current language's
`FLASHBACKS.json` under the shared language lock and includes it in the
translation backup set, so an older output-hash projection cannot survive a
newly completed translation.

When push is enabled, a missing configured remote name is treated as local-only
backup and does not warn. A configured remote that exists but fails to push
creates a critical alert while keeping the local commit.

If SQLite records a successful memory backup but its source `CONTENT.md` path
is missing, outside the configured paths, or untracked, TRAUMA reports a backup
content-integrity alert. This is not a backup location change. The web UI and
CLI offer deletion only for the `missing_file` case, and only after re-checking
that the file is still absent. Untracked or out-of-scope content must be repaired
as backup repository/path state so existing content is not discarded.

## Local Dev Server Contract

The dev server uses the project root `.env` file only for the small set of
operator settings documented in `.env.example`. Keep normal local configuration
minimal; one-off host, port, HMR, smoke, and CI overrides should be supplied by
the shell or the command that needs them.

Standard commands:

- `bun run dev` — start the dev server.
- `bun run dev:smoke` — boot the dev server, probe the canonical
  `GET /` redirect to `/memories`, then exit.
  Fails if the requested port is occupied, the server cannot bind, exits
  early, falls back to a different port, or does not respond within the
  timeout.
- `bun run start` — serve the production build.

Stop the running app before invoking a maintenance CLI that opens the configured
runtime, including `bun run db:migrate` and
`scripts/trauma-backup-failsafe.ts`. Dry-run and status modes also participate
in the lease because database initialization can apply pending migrations.
Start the app again after the command exits.

The smoke launcher supplies an internal multi-signal fixture context so its
loopback `GET /` probe does not depend on a real `trauma.config.json`. The probe
does not follow the redirect and accepts only `302 Location: /memories`. The
fixture flag alone never bypasses the runtime lease. Other paths, query strings,
non-loopback requests, and all mutating methods still require the configured
runtime lease. Run the smoke check before relying on the dev server in CI or
scripted environments.

`bun run test:e2e` boots its own dev server with explicit `HOST=127.0.0.1`,
`PORT=4173`, and `TRAUMA_HMR_PORT=24681`, so it can run alongside
`bun run dev` without HMR port collisions and is unaffected by `.env`. Its
fixed `.trauma/e2e` config acquires ordinary database, project, and store
leases; E2E control is not a runtime-lease bypass. The Playwright harness
preseeds only the config and directories required for server readiness. Named
fixture actions reset data inside that same logical leased root.

## Access Control

TRAUMA has no user accounts, browser sessions, public signup, or multi-user
ownership. Deploy it behind local access controls, private networking, or a
reverse-proxy policy if it is exposed beyond the host.

Requests are accepted for loopback hostnames by default. A reverse proxy that
preserves another hostname must set `TRAUMA_ALLOWED_HOSTS` to the exact
comma-separated hostnames it serves; see the
[configuration reference](../references/configuration.md#trusted-request-hosts).
The host allowlist blocks DNS-rebinding-style boundary confusion but does not
replace proxy authentication or private-network policy.

Codex app-server login used by Brilliant and Psychiatrist authenticates that
backend integration only; it does not protect the TRAUMA web application.
Public or team operation requires a separate auth design and threat model.

## Codex Runtime Isolation

Do not enable production Brilliant translation or Psychiatrist turns against an
app-server that can read the host user's home directory, the TRAUMA application
project, or the memory store. Codex `readOnly` sandbox policy blocks writes but
still allows host reads, so an empty working directory and prompt policy are not
an isolation boundary.

Run the app-server under an independently enforced process or container policy
that exposes none of those host roots. Constrain any app-server egress to public
HTTP(S) destinations; keep private, loopback, link-local, filesystem, and other
protocol destinations unavailable. TRAUMA continues to deny network by default
and requests it only for a user-approved web-source turn.

Only after that external policy is active, start TRAUMA with:

```bash
TRAUMA_CODEX_RUNTIME_ISOLATION=external_no_host_reads_public_http_https_only \
TRAUMA_CODEX_APP_SERVER_ENDPOINT=unix:// bun run start
```

This assertion tells TRAUMA that the operator has supplied the boundary; it
does not create or validate the boundary itself. If it is absent or has any
other value, production translation, message, and Regenerate requests fail
closed with `runtime_isolation_required` and do not start Codex work.
