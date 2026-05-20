# 19.1 Requirements and architecture finalization

## Goal

Freeze the Brilliant architecture before implementation begins.

## Scope

Document the final contracts for storage layout, app-server integration, auth boundary, SSE transport, chunk orchestration, SQLite cleanup, and Reader rendering. This subtask is planning and interface finalization only.

## Inputs

- `docs/workflows/task-19-codex-translation/00-execution-contracts.md`
- `TASK_19_INSTRUCTION.md`
- `docs/INDEX.md`
- `docs/architecture/data-and-storage.md`
- `docs/architecture/flows.md`
- `docs/architecture/ui-and-routing.md`
- `docs/references/glossary.md`
- `docs/workflows/task-18-memory-actions/README.md`

## Outputs

- A short architecture note under `docs/architecture/` or `docs/workflows/task-19-codex-translation/` that records the frozen Brilliant interfaces.
- Final names for job statuses, chunk statuses, SSE event types, and API routes.
- Confirmation that `codex exec` is not the primary production path for Brilliant.

## Dependencies

- Task 18 settings contract for target language and OpenAI/Codex auth surface.

## Acceptance criteria

- The architecture note states that Codex app-server is the preferred integration surface.
- The Reader backend owns storage, chunking, validation, retry, stitching, atomic writes, SQLite cleanup, and frontend SSE.
- The plan chooses SSE as the default transport and justifies it as minimal server-to-client streaming.
- The plan chooses one ephemeral Codex thread per chunk by default.
- The final storage layout is `memory/<memory_id>/<lang_code>/CONTENT.md`.
- The note explicitly forbids persistent `.work/<job_id>` artifacts.
- The note explicitly forbids storing completed translated article bodies in SQLite.
- No implementation files are changed in this subtask unless documentation tooling requires link updates.

## Parallelization notes

This task must complete before parallel implementation tracks begin. It freezes names and contracts consumed by all later subtasks.

## Implementation risks

- If names are not frozen here, later subagents will create incompatible schemas and event envelopes.
- If app-server is treated as optional instead of primary, implementation may regress to the obsolete `codex exec` design.
- If SSE is not chosen explicitly, frontend and backend workers may overbuild WebSocket infrastructure before cancellation or live steering require it.
