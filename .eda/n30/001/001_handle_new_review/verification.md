# Verification

## Parent Review

- Reviewed Revy diffs against `parent-exec-plan.md` and every review item in
  `review-state.json`.
- Returned one gap to Revy: same-pair approved retry needed concrete field names,
  not only prose.
- Re-reviewed the follow-up diff and confirmed the HTTP and TypeScript contracts
  now specify `retry_pair_id` / `retry_turn_id` and `retryPairId` / `retryTurnId`.

## Commands

```bash
git diff --check
```

Result: passed.

```bash
rg -n 'latest known Codex app-server thread id|stored Codex thread id|/api/psychiatrist-threads/:threadId/messages|rejects pending, failed, stale|original retry target identity|only `THREAD.json`, `PAIRS.jsonl`, and' docs/workflows/task-24-psychiatrist-assistant
```

Result: passed with no matches.

```bash
rg -n 'POST /api/memories/:memoryId/psychiatrist/threads/:threadId/messages|retry_pair_id|retry_turn_id|appServerThreadId|appServerTurnId|Permission To Runtime Mapping|prompt policy version|no-gap replay-to-live|current memory content changed' docs/workflows/task-24-psychiatrist-assistant
```

Result: passed with expected matches in Task 24 docs.

```bash
mise exec -- bun run typecheck
```

Result: not completed. `mise` rejected `/private/tmp/trauma-pr30-review-docs/mise.toml`
as untrusted in this isolated worktree.

```bash
bun run typecheck
```

Result: not completed. The isolated worktree has no `node_modules`, so `tsc` was
not found. This is recorded as an environment/toolchain caveat for a docs-only
change; no TypeScript source, package, or test files were changed.

## Final Diff Scope

```text
docs/workflows/task-24-psychiatrist-assistant/01-codex-conversation-adapter.md
docs/workflows/task-24-psychiatrist-assistant/02-memory-context-and-prompt-contract.md
docs/workflows/task-24-psychiatrist-assistant/03-thread-storage-api-and-streaming-events.md
docs/workflows/task-24-psychiatrist-assistant/04-reader-floating-dock-and-chat-ui.md
docs/workflows/task-24-psychiatrist-assistant/05-safety-freshness-and-errors.md
docs/workflows/task-24-psychiatrist-assistant/07-psychiatrist-skill-and-runtime-policy.md
docs/workflows/task-24-psychiatrist-assistant/08-streaming-continuity-regenerate-backup.md
.eda/n30/001/001_handle_new_review/
```
