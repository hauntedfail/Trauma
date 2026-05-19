# Task 19 subtasks

Implement these subtasks sequentially on `feat/codex-translation`.

## Order

1. [19.1 Codex auth boundary and credential storage](01-codex-auth-boundary.md)
2. [19.2 Translation storage and database foundation](02-translation-storage-and-db-foundation.md)
3. [19.3 Codex translation runner](03-codex-translation-runner.md)
4. [19.4 Settings auth and CLI wiring](04-settings-auth-and-cli-wiring.md)
5. [19.5 Reader translation UI and API](05-reader-translation-ui-and-api.md)
6. [19.6 Integration verification and handoff](06-integration-verification-and-handoff.md)

## Rules for agents

- Do not read, print, log, copy, commit, or expose `~/.codex/auth.json`.
- Do not store Codex access tokens in TRAUMA SQLite.
- Use Codex CLI as the credential owner unless a future official API explicitly supports app-managed ChatGPT sign-in credentials.
- Keep source `CONTENT.md` immutable during translation.
- Store translated content under `{memoryId}/{langCode}/CONTENT.md`.
- Translation output must be validated before writing.
- Task 18 settings are the source for target language and auth status UI surface.

