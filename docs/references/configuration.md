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
