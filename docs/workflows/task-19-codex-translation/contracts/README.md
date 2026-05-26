# Brilliant focused contracts

This directory keeps Brilliant implementation contracts split by domain. Do not merge these details back into one large file. The point of this directory is to let each implementation worker load only the contract relevant to its assigned subtask.

## Files

- `01-architecture-and-ownership.md`: file ownership and boundary rules.
- `02-types-state-and-settings.md`: shared TypeScript types, state machine values, and SQLite-backed language setting.
- `03-sqlite-and-repositories.md`: database tables, indexes, hashes, paths, and repository methods.
- `04-api-and-sse.md`: API contracts, SSE envelope, reconnect policy, cancellation.
- `05-markdown-chunking.md`: Markdown block scanner, protected spans, chunking defaults.
- `06-codex-prompt-and-validation.md`: Codex app-server client, prompt, schema, validator, retry.
- `07-atomic-commit-purge-recovery.md`: final write, SQLite purge, and crash recovery.
