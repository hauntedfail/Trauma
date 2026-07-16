# Configuration Reference

TRAUMA uses static JSON configuration at the project root:

```text
trauma.config.json
```

The current configuration contract does not allow executable config files or
arbitrary lifecycle hooks.

Runtime UI preferences are stored in SQLite, not in `trauma.config.json`.
Codex translation defaults such as the selected model and reasoning effort are
managed through `app_settings` so the reader translation popover can reopen with
the user's last saved selections.

## Configuration Shape

```json
{
  "storePath": "./data/storage",
  "projectPath": "./data",
  "databasePath": "./.trauma/trauma.sqlite",
  "backup": {
    "git": {
      "enabled": true,
      "remote": "origin",
      "branch": "main",
      "push": false,
      "commitMessageTemplate": "backup {action} {memoryId}"
    }
  }
}
```

The implementation resolves relative paths against the directory that contains
the config file. JSON config does not perform shell expansion: `~` is rejected
instead of being treated as a home-directory shortcut. Use an absolute path such
as `/Users/name/trauma-data` or a config-relative path such as `./data`.

## Path Rules

- `storePath` contains source/translated reader files, metadata exports, and
  memory-local Psychiatrist thread artifacts.
- `projectPath` is the git working directory used by built-in backup.
- `storePath` must be inside `projectPath`.
- `databasePath` points to the SQLite runtime database.
- `databasePath` must be outside `storePath`, which keeps the SQLite database
  outside TRAUMA's built-in store-backup scope.

Invalid path relationships are startup errors.

## Backup Environment Failsafe

When git backup is enabled, TRAUMA stores a backup environment stamp in SQLite
after validating the backup location. The stamp records the resolved
`projectPath`, `storePath`, remote name, remote URL when available, branch, and
timestamps.

If the configured paths later differ while existing memory data is present,
TRAUMA creates a critical backup failsafe alert instead of silently writing
content into the new location. The alert is shown in the app shell and logs
terminal recovery commands:

```bash
mise exec -- bun run scripts/trauma-backup-failsafe.ts revert --config trauma.config.json
mise exec -- bun run scripts/trauma-backup-failsafe.ts migrate --config trauma.config.json
```

Both commands are dry-run by default. Add `--apply` only after checking the
summary. An applied config revert writes and syncs a same-directory temporary
file before atomic replacement. A write, sync, or rename failure leaves the
previous config intact and removes the temporary file.

If the stamp and configured paths still match but SQLite says a memory was
successfully backed up while its `CONTENT.md` is missing, outside the configured
backup paths, or not tracked by the backup repository, TRAUMA creates a separate
content-integrity alert. This is not a backup location change, so path migration
actions must not be offered for that alert.

A legacy `redacted:migration-0016` remote value is an unknown identity, not a
wildcard match. Existing data therefore remains fail-closed until the operator
reviews the current repository and explicitly applies the `migrate` recovery;
that action records the current remote fingerprint without persisting its URL or
credentials.

When the content-integrity reason is `missing_file`, the UI and CLI may offer a
delete recovery that removes the orphan SQLite `memories` row. This recovery is
not available for untracked or out-of-scope content because those cases may
still have recoverable markdown content.

## Backup Rules

`backup.git.enabled` controls built-in backup for explicitly enqueued store
artifacts.

When enabled, TRAUMA stages only files under `storePath`, commits with
`commitMessageTemplate`, and pushes only when `backup.git.push` is true.

`commitMessageTemplate` supports these placeholders:

- `{action}`: human-readable backup action, such as `created memory`,
  `deleted memory`, or `updated flashbacks`.
- `{memoryId}` and `{memory_id}`: the memory id.
- `{reason}`: the raw backup trigger, such as `memory_creation`,
  `memory_deletion`, or `flashback_update`.

`projectPath` is the backup repository root. TRAUMA does not use the application
repository as an implicit backup repository. On a clean first start, TRAUMA may
initialize `projectPath` as a git repository. On non-clean data, missing or
mismatched git repository state becomes a critical failsafe alert.

When `backup.git.push` is true, a missing remote name skips push without a
warning and keeps the local backup commit. If the remote exists but push fails,
TRAUMA records a critical push-failure alert.

No generic command hooks are part of the current contract.

## Trusted Request Hosts

TRAUMA accepts `localhost`, `127.0.0.1`, and `::1` request hosts by default.
This prevents a public hostname that resolves to the loopback interface from
crossing the local-only boundary.

When a reverse proxy preserves a different `Host` value, add its exact hostname
through a comma-separated server environment variable. Entries are hostnames,
not URLs, ports, or wildcard patterns:

```bash
TRAUMA_ALLOWED_HOSTS=archive.example,reader.example bun run start
```

This allowlist is not authentication. Non-local deployments still require the
access controls described in the operations guide.

## Browser-Assisted Import Environment

Environment variables can be specified in the project root `.env` file when
running TRAUMA through `bun run` scripts. The shell environment still has
precedence over `.env`.

Browser-assisted import is an optional local extension path. It is disabled by
default and configured through environment variables, not `trauma.config.json`.
Keep `.env` minimal for normal local use:

```text
TRAUMA_BROWSER_IMPORT_ENABLED=false
TRAUMA_BROWSER_IMPORT_TOKEN=
```

- `TRAUMA_BROWSER_IMPORT_ENABLED` must be `true` before the API accepts imports.
- `TRAUMA_BROWSER_IMPORT_TOKEN` is a local bearer token shared with the browser
  extension settings. When import is enabled it must contain at least 32
  URL-safe characters. Generate a random value with `openssl rand -hex 32` and
  do not commit it.

Advanced operator and CI overrides, such as runtime config path, Drizzle CLI
database path, dev smoke tuning, fixture mode, or browser import origin/size
limits, should be set explicitly in the shell or CI job that needs them. They
are intentionally not part of `.env.example`.

## Codex App-Server Environment

Brilliant translation and Psychiatrist are optional backend-only consumers of a
separately running Codex app-server. TRAUMA does not start or supervise that
process.

Use the Codex app-server Unix listener when enabling these features:

```bash
codex app-server --listen unix://
TRAUMA_CODEX_APP_SERVER_ENDPOINT=unix:// bun run dev
```

For `unix://`, TRAUMA connects to Codex's default app-server control socket at
`~/.codex/app-server-control/app-server-control.sock`. Set
`TRAUMA_CODEX_APP_SERVER_SOCKET_PATH` only when a local operator workflow uses a
different socket path. Loopback WebSocket endpoints are not supported. `http://`,
`https://`, `ws://`, and `stdio://` are rejected because they are not Brilliant
wire-protocol transports.

Brilliant translation and Psychiatrist production turns require a separately
enforced runtime boundary. Codex `sandboxPolicy: readOnly` prevents writes, but
it does not remove shell or file-read capabilities and is not sufficient
isolation for untrusted imported content or transcripts. The external boundary
must make the user's home directory, application project, and memory store
unreadable to the app-server runtime. If egress is available, constrain it to
public HTTP(S); Psychiatrist still enables it only for a user-approved web-source
turn.

After independently enforcing that boundary, the operator must make this exact
assertion in the TRAUMA server environment:

```bash
TRAUMA_CODEX_RUNTIME_ISOLATION=external_no_host_reads_public_http_https_only \
TRAUMA_CODEX_APP_SERVER_ENDPOINT=unix:// bun run dev
```

Without the exact assertion, translation and Psychiatrist mutation routes fail
with `runtime_isolation_required` before reserving Codex work. The variable is
only an operator-controlled fail-closed gate. It does not create, inspect, or
verify a sandbox, and it must not be set until the app-server process or
container is actually isolated. The legacy
`TRAUMA_PSYCHIATRIST_RUNTIME_ISOLATION` name remains accepted for compatibility;
new deployments should use the shared name.
