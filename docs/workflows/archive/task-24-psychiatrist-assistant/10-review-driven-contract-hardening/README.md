# 24.10 Review-Driven Contract Hardening

## Goal

Reopen Task 24 after PR review, convert repeated review feedback into durable
file-scoped implementation contracts, and finish the branch without another
ad hoc review-and-fix loop.

This directory is the 24.10 parent index. It must stay small. Each child file is
the execution plan for one focused implementation unit and names the exact code
files, tests, failure modes, and verification evidence for that unit.

## Required Context

Agents should read only:

- `docs/workflows/archive/task-24-psychiatrist-assistant/README.md`
- this index
- the assigned 24.10 child workflow
- the target files and tests named by that child workflow

If a child workflow grows beyond the named file set, split that child before
coding. Do not grow this index to carry implementation detail.

## Subtask Order

| Order | Workflow | Primary File Scope | Purpose |
| --- | --- | --- | --- |
| 24.10.1 | [Review history and audit reset](01-review-history-and-audit-reset.md) | `09-completion-audit.md`, PR review metadata | Reset the false completion state and deduplicate review feedback before more code changes. |
| 24.10.2 | [Source citation URL policy](02-source-citation-url-policy.md) | `source-citations.ts`, citation tests | Replace token-list sanitization with an explicit source URL projection contract. |
| 24.10.3 | [Codex turn identity](03-codex-turn-identity.md) | `codex-app-server.ts`, translation adapter tests | Require exact turn identity before accepting deltas or text completions. |
| 24.10.4 | [Thread terminal state machine](04-thread-terminal-state-machine.md) | `thread-store.ts`, thread-store tests | Make terminal transitions single-owner and race-proof. |
| 24.10.5 | [Regenerate server retry projection](05-regenerate-server-retry-projection.md) | regenerate/thread route and pair response types | Persist and reload web-source approval state for regenerate attempts. |
| 24.10.6 | [Reader transcript regenerate draft](06-reader-transcript-regenerate-draft.md) | `psychiatrist-transcript.ts`, reader component tests | Keep old completed answers canonical until a regenerate turn completes. |
| 24.10.7 | [Process event and stream safety](07-process-event-and-stream-safety.md) | app-server process projection and stream storage | Define a safe process-event projection contract instead of relying on broad redaction. |
| 24.10.8 | [Verification and review handoff](08-verification-and-review-handoff.md) | PR handoff, review replies, verification evidence | Block re-review until the 24.10 matrix, tests, duplicate sweep, and inline replies are complete. |

## Execution Rules

- Execute in order unless separate git worktrees are created for truly
  independent file sets.
- Do not parallelize child workflows that name the same implementation file.
  For example, 24.10.4 and 24.10.5 both touch `thread-store.ts`, so 24.10.4
  must settle before 24.10.5 starts.
- Start each child workflow with failing tests that demonstrate the named bug.
- Do not patch only the quoted review symptom. Implement the durable contract
  defined by the child workflow.
- Preserve the Task 24 security policy: no browser access to app-server
  internals, no unapproved network access, no shell/file/project/store access
  from Psychiatrist app-server turns, and no credential-bearing citation output.
- Resolve duplicate review comments with one implementation and replies on
  every affected review thread.
- Completion requires a final 24.10 handoff pass, commit, push, and PR review
  status ready for review.
