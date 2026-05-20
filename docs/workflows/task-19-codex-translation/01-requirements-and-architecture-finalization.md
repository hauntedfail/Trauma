# 19.1 Requirements and architecture finalization

## Goal

Freeze Brilliant implementation boundaries before code work starts. This subtask turns the product instruction into stable implementation contracts and does not implement application code.

## Files likely owned

- `docs/workflows/task-19-codex-translation/00-execution-contracts.md`
- `docs/workflows/task-19-codex-translation/contracts/README.md`
- `docs/workflows/task-19-codex-translation/contracts/01-architecture-and-ownership.md`
- `docs/workflows/task-19-codex-translation/contracts/02-types-state-and-settings.md`
- `docs/workflows/task-19-codex-translation/contracts/03-sqlite-and-repositories.md`
- `docs/workflows/task-19-codex-translation/contracts/04-api-and-sse.md`
- `docs/workflows/task-19-codex-translation/contracts/05-markdown-chunking.md`
- `docs/workflows/task-19-codex-translation/contracts/06-codex-prompt-and-validation.md`
- `docs/workflows/task-19-codex-translation/contracts/07-atomic-commit-purge-recovery.md`

## Contract references

Read all focused contract files for this subtask.

## Instruction alignment

Scope: planning contracts only; no application code.

Inputs: `TASK_19_INSTRUCTION.md`, current TRAUMA docs, current settings/storage implementation, and official Codex app-server protocol.

Outputs: frozen Brilliant contract files, storage path mapping, route shape, app-server wire-protocol boundary, auth boundary, and subtask dependency map.

Dependencies: none; this subtask gates all other Brilliant work.

Parallelization notes: do not parallelize downstream implementation until this subtask freezes shared names and interfaces.

Implementation risks: copying the instruction's conceptual `memory/` path literally would create a second store tree; omitting app-server wire-protocol lifecycle details would make Codex integration non-implementable.

## Architecture contract

Brilliant uses Codex app-server as the preferred production integration surface. The Reader backend owns source loading, chunking, metadata, translation job state, validation, retry, stitching, atomic final writes, SQLite cleanup, and frontend event streaming.

Codex receives chunk text, metadata, and translation instructions. Codex does not own article storage layout and must not write canonical translated `CONTENT.md` files.

The browser never talks to Codex app-server directly. The browser talks only to TRAUMA backend APIs and SSE endpoints.

The canonical translated file layout is:

```text
memories/<memory_id>/CONTENT.md
memories/<memory_id>/<lang_code>/CONTENT.md
```

This is the repo-correct implementation of the instruction's conceptual `memory/<memory_id>/<lang_code>/CONTENT.md` requirement. Do not create a singular `memory/` directory.

The selected target language comes from the SQLite-backed `/settings` value, for example `translation_target_lang_code = "ja-JP"`.

## Freeze checklist

Before later subtasks start, confirm these names and contracts are stable:

- `feat/brilliant` implementation branch.
- `translation_jobs` and `translation_chunks` table names.
- `TranslationJobStatus` and `TranslationChunkStatus` values.
- `POST /api/memories/:memory_id/translations` job start route.
- `GET /api/translation-jobs/:job_id/events` SSE route.
- SSE event names under `translation.*`.
- Markdown block id format `b000001`.
- Hash format `sha256:<hex>`.
- Final output path `memories/<memory_id>/<lang_code>/CONTENT.md`.
- Translated reader route `/memories/:lang_code/:id`.
- Codex app-server wire-protocol lifecycle: connect, `initialize`, `initialized`, `account/read`, `thread/start`, `turn/start`, notifications, and optional `turn/interrupt`.
- Codex app-server transport boundary: `codex app-server --listen unix://` is TRAUMA's required default wire-protocol transport; loopback WebSocket is local development fallback only; HTTP is health-probe-only; `stdio` process ownership and the Codex CLI no-flag `stdio` default are outside Brilliant MVP.
- Codex translation thread/turn security policy: `approvalPolicy: "never"`, read-only sandbox, no direct filesystem reads from the TRAUMA project or store, and no network access when the installed app-server schema supports that field for the selected sandbox. If schema support differs, update the Brilliant contract with the equivalent minimum-privilege payload before implementation.
- Temp final-write path `.CONTENT.<job_id>.tmp` in the language directory.

## Tests

No application tests are required in this subtask. If docs tooling exists, run the focused docs validation command used by the project.

## Verification

```sh
# Optional only if docs validation exists in the repo
mise exec -- bun run verify:docs
```

If no docs verification command exists, record that this subtask is documentation-only and no validation was run.

## Acceptance criteria

- The focused contract files are small enough for subtask workers to load selectively.
- The parent README maps each subtask to only the contracts it needs.
- Codex app-server is documented as the preferred integration path.
- Reader-owned orchestration is explicit.
- SQLite-backed settings language is explicit.
- Persistent `.work/<job_id>` artifacts are forbidden.
- Later subtasks do not need to invent table names, route names, event names, or storage paths.
