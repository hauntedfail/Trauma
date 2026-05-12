# Configuration Reference

Trauma uses static JSON configuration at the project root:

```text
trauma.config.json
```

The initial design does not allow executable config files or arbitrary
lifecycle hooks.

## Initial Shape

```json
{
  "storePath": "./data/store",
  "projectPath": "./data",
  "databasePath": "./.trauma/trauma.sqlite",
  "backup": {
    "git": {
      "enabled": true,
      "remote": "origin",
      "branch": "main",
      "push": false,
      "commitMessageTemplate": "backup memory {memoryId}"
    }
  }
}
```

The implementation resolves relative paths against the directory that contains
the config file.

## Path Rules

- `storePath` contains memory markdown files.
- `projectPath` is the git working directory used by built-in backup.
- `storePath` must be inside `projectPath`.
- `databasePath` points to the SQLite runtime database.
- `databasePath` must be outside `storePath`, which keeps the SQLite database
  outside Trauma's markdown backup scope.

Invalid path relationships are startup errors.

## Backup Rules

`backup.git.enabled` controls built-in markdown backup.

When enabled, Trauma stages only files under `storePath`, commits with
`commitMessageTemplate`, and pushes only when `backup.git.push` is true.

No generic command hooks are part of the initial design.

## Browser-Assisted Import Environment

Environment variables can be specified in the project root `.env` file when
running Trauma through `bun run` scripts. The shell environment still has
precedence over `.env`.

`TRAUMA_CONFIG_PATH` selects the runtime config file. It defaults to
`./trauma.config.json` when unset.

`TRAUMA_DATABASE_PATH` is a Drizzle Kit CLI override. Normal app runtime uses
`databasePath` from `trauma.config.json`.

Browser-assisted import is an optional local extension path. It is disabled by
default and configured through environment variables, not `trauma.config.json`.

```text
TRAUMA_BROWSER_IMPORT_ENABLED=false
TRAUMA_BROWSER_IMPORT_TOKEN=
TRAUMA_BROWSER_IMPORT_ALLOWED_ORIGINS=
TRAUMA_BROWSER_IMPORT_MAX_BYTES=5000000
```

- `TRAUMA_BROWSER_IMPORT_ENABLED` must be `true` before the API accepts imports.
- `TRAUMA_BROWSER_IMPORT_TOKEN` is a local bearer token shared with the browser
  extension settings. Do not commit it.
- `TRAUMA_BROWSER_IMPORT_ALLOWED_ORIGINS` is an optional comma-separated list of
  exact extension origins, such as `chrome-extension://<extension-id>`. When it
  is empty, the API still rejects ordinary web origins and accepts only
  `chrome-extension://` origins with a valid token.
- `TRAUMA_BROWSER_IMPORT_MAX_BYTES` bounds the JSON body and captured HTML.

Dev smoke variables are also `.env` compatible:

- `TRAUMA_DEV_HOST`
- `TRAUMA_DEV_PORT`
- `TRAUMA_DEV_SMOKE_PATH`
- `TRAUMA_DEV_SMOKE_TIMEOUT_MS`
- `TRAUMA_DEV_SMOKE_POLL_MS`

`TRAUMA_BROWSE_FIXTURES=1` is reserved for dev smoke and Playwright fixture
mode. Do not enable it for normal app use.
