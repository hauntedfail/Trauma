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

Browser-assisted import is an optional local extension path. It is disabled by
default and configured through environment variables, not `trauma.config.json`.
Keep `.env` minimal for normal local use:

```text
TRAUMA_BROWSER_IMPORT_ENABLED=false
TRAUMA_BROWSER_IMPORT_TOKEN=
```

- `TRAUMA_BROWSER_IMPORT_ENABLED` must be `true` before the API accepts imports.
- `TRAUMA_BROWSER_IMPORT_TOKEN` is a local bearer token shared with the browser
  extension settings. Do not commit it.

Advanced operator and CI overrides, such as runtime config path, Drizzle CLI
database path, dev smoke tuning, fixture mode, or browser import origin/size
limits, should be set explicitly in the shell or CI job that needs them. They
are intentionally not part of `.env.example`.
