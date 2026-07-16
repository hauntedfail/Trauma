# 24.10.8 Verification And Review Handoff

## Goal

Close 24.10 with evidence that the underlying contracts were repaired, not just
that individual review comments were patched. This subtask owns the final
verification, inline replies, duplicate handling, commit, push, and PR-ready
state.

## Files Owned

- Modify only if needed: `docs/workflows/archive/task-24-psychiatrist-assistant/09-completion-audit.md`
- Modify only if needed: `docs/workflows/archive/task-24-psychiatrist-assistant/10-review-driven-contract-hardening/README.md`
- No application code should be edited in this handoff subtask unless a prior
  child workflow is reopened.

## Required Verification Matrix

The final handoff must include one row per 24.10 child workflow:

| Workflow | Evidence Required |
| --- | --- |
| 24.10.1 | Review-thread dedupe result, updated audit state, and no stale completion claim. |
| 24.10.2 | Source citation URL policy tests, including signed URL and private-host rejection. |
| 24.10.3 | Codex reused-thread stale notification tests and translation regression tests. |
| 24.10.4 | Terminal-state race tests proving first terminal state wins. |
| 24.10.5 | Reload test proving regenerate web approval state survives and routes to regenerate. |
| 24.10.6 | Live reducer and reload tests proving partial regenerate output never replaces the completed answer before success. |
| 24.10.7 | Process projection/replay tests proving raw unsafe payloads are not stored. |

## Review Handoff Gate

Before requesting re-review:

- refresh PR review threads from GitHub;
- confirm every non-outdated unresolved comment is mapped to a 24.10 workflow
  or explicitly deferred with user approval;
- identify duplicate threads and reply to every duplicate after the shared fix;
- add inline replies on the original review threads, not only a top-level PR
  summary;
- verify the PR is not draft and is ready for review;
- do not force-push or rewrite remote history.

## Command Baseline

Run focused tests from each child workflow first. Then run:

```bash
mise exec -- bun run typecheck
mise exec -- bun run test
mise exec -- bun run test:e2e e2e/reader.spec.ts -g "psychiatrist"
git diff --check
mise exec -- bun run verify
```

If full E2E or full verify cannot run, the handoff must say exactly why and
must list the strongest completed focused evidence.

## PR Evidence Requirements

The PR summary or follow-up comment must include:

- the 24.10 contract matrix and verification results;
- any duplicate review threads found and how they were handled;
- exact test commands and pass/fail outcomes;
- known residual risks or explicitly deferred items;
- commit SHA and pushed branch;
- statement that the PR remains ready for review.

## Sawyer Finalization

After implementation and verification, invoke Sawyer with:

- working directory and branch;
- files intended for staging;
- verification evidence;
- review-thread replies still needed;
- `.sawyer/exclude-whitelist.txt` reminder;
- no-force-push rule.

Sawyer owns staging, signed commit creation, and push. Completion is blocked
until Sawyer reports the commit SHA and push result.
