# Brilliant execution contract index

## Purpose

This file is intentionally small. It routes each implementation subtask to the focused contract files it needs, so workers do not have to load one large context file before every change.

## Rule for implementation agents

Read this file first, then read only the contract files listed for your assigned subtask plus the assigned subtask file itself.

If a contract conflict exists, use this precedence order:

1. Focused files under `docs/workflows/task-19-codex-translation/contracts/`.
2. The assigned `19.x` subtask file.
3. Parent workflow and README summaries.

`TASK_19_INSTRUCTION.md` was the source input for this planning branch, but implementation workers must not depend on that root file being present.

## Canonical names

- Product task name: `Brilliant`
- Implementation branch: `feat/brilliant`
- Feature purpose: Codex app-server powered translation for Reader memory content
- Source content path: `memory/<memory_id>/CONTENT.md`
- Translated content path: `memory/<memory_id>/<lang_code>/CONTENT.md`
- Japanese language code: `ja-JP`
- Translation target language source: `/settings` user setting persisted in SQLite
- Default progress transport: SSE
- Codex integration: backend-only Codex app-server client
- Default Codex thread strategy: one ephemeral Codex thread per chunk

## Contract files

- [Contracts README](contracts/README.md): map of focused contract files.
- [Architecture and ownership](contracts/01-architecture-and-ownership.md): file ownership, boundaries, and subagent write scopes.
- [Types, state, and settings](contracts/02-types-state-and-settings.md): shared TypeScript types, job/chunk states, and SQLite-backed language setting.
- [SQLite and repositories](contracts/03-sqlite-and-repositories.md): DDL, indexes, hashes, paths, and repository methods.
- [API and SSE](contracts/04-api-and-sse.md): backend endpoints, payloads, SSE envelope, reconnect, and cancellation.
- [Markdown chunking](contracts/05-markdown-chunking.md): block scanner, protected spans, chunk config, and chunk metadata.
- [Codex prompt and validation](contracts/06-codex-prompt-and-validation.md): app-server client boundary, prompt sections, output schema, validation, and retry.
- [Atomic commit, purge, and recovery](contracts/07-atomic-commit-purge-recovery.md): final write sequence, purge policy, and crash recovery.

## Subtask contract map

- 19.1 Requirements and architecture finalization: read all contract files.
- 19.2 SQLite schema and migration design: read 02, 03, 07.
- 19.3 Translation job state machine: read 02, 03, 04, 07.
- 19.4 Markdown block manifest and chunker: read 02, 05.
- 19.5 Codex app-server integration: read 04, 06.
- 19.6 Codex auth and device-code setup flow: read 02, 04, 06.
- 19.7 Streaming event bridge to frontend: read 04.
- 19.8 Chunk translation prompt and output schema: read 05, 06.
- 19.9 Chunk validation and retry logic: read 05, 06.
- 19.10 Stitching and atomic commit: read 03, 05, 07.
- 19.11 SQLite cleanup and purge policy: read 03, 07.
- 19.12 Frontend translation controls and progress UI: read 02, 04.
- 19.13 Reader render integration for translated CONTENT.md: read 02, 03, 07.
- 19.14 Translation skill definition: read 06.
- 19.15 Error handling and cancellation: read 02, 04, 07.
- 19.16 Test plan and fixtures: read the contract files for the tests being implemented.
- 19.17 End-to-end validation with long paper fixture: read 02, 03, 04, 05, 06, 07.

## Per-subtask report requirements

Every implementation subtask must report:

- Changed files
- New interfaces
- Assumptions
- Risks
- Required follow-up
- Verification commands and results, or explicit reason validation was skipped
