# Task 08: Git Backup Queue Workflow

## Goal

Implement built-in asynchronous git backup for markdown store changes.

## Required Context

- [Runtime flows](../architecture/flows.md)
- [Local/self-hosting operation](../operations/local-self-hosting.md)
- [Configuration reference](../references/configuration.md)

## Ownership

Primary files and directories:

- `src/server/backup/**`
- Backup status repository helpers under `src/server/db/**`
- Backup integration points in add memory and highlight flows.
- `tests/server/backup/**`

Do not introduce Redis, external queues, or generic lifecycle hooks.

## Implementation Steps

1. Define backup job contract.
   - Memory ID.
   - Content paths under `storePath`.
   - Trigger reason: memory creation or highlight update.

2. Implement in-process queue.
   - Sequential processing.
   - No concurrent git operations.
   - Clear state transitions backed by one shared `BackupStatus` source of
     truth for TypeScript, SQLite constraints, and tests.

3. Implement git runner.
   - Use `projectPath` as cwd.
   - Stage only paths under `storePath`.
   - Commit with configured message template.
   - Push only when `backup.git.push` is true.

4. Implement startup retry.
   - Find pending or failed eligible backups.
   - Re-enqueue without duplicating active work.

5. Add tests with temporary git repos.
   - Stages only store files.
   - Creates commit.
   - Does not push when disabled.
   - Failure updates metadata without rolling back memory/highlight creation.

6. Wire enqueue calls.
   - Add memory flow enqueues after `CONTENT.md` write.
   - Highlight flow enqueues after mark insertion.

## Acceptance Criteria

- Backup is built-in git backup only.
- Queue is process-local and sequential.
- Status and errors are persisted in SQLite metadata.
- Tests never push to a real remote.
- Memory/highlight writes survive backup failure.

## Verification

Run:

```bash
bun run typecheck
bun run test
bun run build
```

Run E2E only if this task also exposes backup status UI:

```bash
bun run test:e2e
```

## PR Handoff

The PR description must include:

- Queue states.
- Backup status source-of-truth location.
- Git commands executed by the runner.
- Temporary git repo test strategy.
- Exact verification commands and outcomes.
