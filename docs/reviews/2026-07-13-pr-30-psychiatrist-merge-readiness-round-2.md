# PR #30 Psychiatrist merge-readiness review, round 2

Date: 2026-07-13 JST
Pull request: [#30 docs: plan psychiatrist workflow](https://github.com/hauntedfail/Trauma/pull/30)
Code head reviewed: `0b567edfffd793a56c570388d0d8e3841684b9d2`
Head branch: `docs/task-24-psychiatrist-plan`
Dedicated implementation worktree: `/private/tmp/trauma-pr30-review-followup-20260712`

## Outcome

The added Codex review was processed end to end with EDA in
`parent-subtasks` mode. All five inline findings were accepted, fixed with
regression coverage, replied to inline, reacted to, and resolved. The generic
review body contained no independent technical claim and was recorded as a
`not_valid` standalone item through a PR trace comment.

After the GitHub findings were closed, repeated detached local reviews found
and fixed additional backup durability, replay recovery, Regenerate, Stop,
thread-reload, approval-retry, and browser SSE transport defects. Review and
repair continued until independent backend and UI acceptance reviews reported
no actionable finding at the final code head.

At `0b567ed`:

- local HEAD and the live PR head matched;
- all commits were GPG-signed and pushed normally without history rewriting;
- the fresh GraphQL sweep returned zero unresolved review threads;
- GitHub reported the PR as mergeable;
- CodeRabbit and GitHub Actions Verify passed;
- full repository verification, Playwright, and development startup smoke passed.

The ignored EDA execution packet remains at:

`.eda/n30/002/002_review_comments_and_merge_ready_loop/`

## Canonical GitHub review inventory

Planning mode: `parent-subtasks`

| Canonical item | Adjudication | Outcome |
| --- | --- | --- |
| [Review 4680524779](https://github.com/hauntedfail/Trauma/pull/30#pullrequestreview-4680524779) | `not_valid` as a standalone item | Generic Codex review container; its inline claims were handled separately. Recorded in the [trace and re-review comment](https://github.com/hauntedfail/Trauma/pull/30#issuecomment-4952725751). |
| [3566836234](https://github.com/hauntedfail/Trauma/pull/30#discussion_r3566836234) | `must_fix` | Regenerate now rejects old prompt-policy manifests before mode resolution or any turn side effect while preserving stored-context Regenerate. [Inline reply](https://github.com/hauntedfail/Trauma/pull/30#discussion_r3567095591). |
| [3566836238](https://github.com/hauntedfail/Trauma/pull/30#discussion_r3566836238) | `must_fix` | A running same-memory backup always receives one merged follow-up, including identical and subset paths. [Inline reply](https://github.com/hauntedfail/Trauma/pull/30#discussion_r3567095589). |
| [3566836239](https://github.com/hauntedfail/Trauma/pull/30#discussion_r3566836239) | `must_fix` | Completion persists one canonical terminal after enqueue transition outcome and before worker file snapshot. [Inline reply](https://github.com/hauntedfail/Trauma/pull/30#discussion_r3567095577). |
| [3566836240](https://github.com/hauntedfail/Trauma/pull/30#discussion_r3566836240) | `must_fix` | Stop uses typed results and canonical reconciliation before actions become available. [Inline reply](https://github.com/hauntedfail/Trauma/pull/30#discussion_r3567095578). |
| [3566836243](https://github.com/hauntedfail/Trauma/pull/30#discussion_r3566836243) | `must_fix` | Directly owned inactive turns reconcile even when replay is absent or empty. [Inline reply](https://github.com/hauntedfail/Trauma/pull/30#discussion_r3567095576). |

All five original comments received a `+1` reaction. Their GraphQL threads are
resolved. The re-review request was included in the trace comment after the
first pushed remediation and green CI; subsequent sweeps found no new
unresolved Codex thread.

## Ordered Revy implementation units

### 001: Regenerate invariants

- Rejected old policy versions before ID generation, reservation, Codex,
  stream, or backup work.
- Removed the live-memory hash preflight that incorrectly rejected historical
  Regenerate; stored `PROMPT.md` and `CONTEXT.json` remain authoritative.
- RED: two API failures proved ID generation was reachable and changed current
  memory returned 409 instead of the required 202.

### 002: backup queue boundary

- Removed the running-path suppression that lost identical/subset writes.
- Added `enqueue(input, finalizer?)`: queued state is durable before the short
  finalizer and the worker cannot start until finalization succeeds.
- RED: the second snapshot was missing; old code ran the worker before the
  ignored finalizer and ignored its rejection.

### 003: terminal publication and replay recovery

- First-answer and Regenerate completion now write exactly one terminal event.
- Empty replay reconciles the directly requested inactive turn.
- Missing canceled replay is repaired without duplicating existing terminals.
- RED: eight failures covered premature and duplicate terminals, three empty
  replay recovery paths, and missing canceled replay.

### 004: Stop, readiness, and accessibility

- Added runtime-validated cancel results and explicit
  `starting | running | stopping | idle` phases.
- Added initial thread readiness/retry, disabled busy Regenerate controls, and
  one scoped atomic polite live region.
- RED: cancel returned `undefined`, malformed success was accepted, and partial
  output remained after canceled-without-SSE.

### 005: failed-finalizer intent retention

- Replaced count-only intent recovery with full per-memory jobs, retaining
  paths and newest trigger reason.
- Restored pending status when no runnable job owns queued state.
- RED: standalone failure left ghost queued state; a later different-path job
  omitted the retained Psychiatrist path; sequential intent order was reversed.

### 006: UI terminal and approval races

- A terminal SSE received during Stop invalidates the pending Stop generation.
- Ambiguous approval mutations reconcile canonical state and preserve the CTA
  if reconciliation fails.
- Stop reload adopts a different canonical active turn.
- RED: ghost Stop returned after terminal SSE, successor was not adopted, and
  approval CTA disappeared after a failed mutation.

### 007: real browser SSE transport

- Added a native Chromium EventSource test using a controllable HTTP SSE
  response.
- It verifies scoped URL/query construction, named events, a held-open running
  stream, terminal projection, and client-driven close.
- Removed dead Playwright route/state that the in-memory fake never requested.
- RED: the prior implied transport assertion received no event request.

### 008: changed-thread Stop reconciliation

- Post-Stop reload validates reader generation and reconciles the newly
  installed thread identity instead of requiring the stopped identity.
- Changed idle threads clear old state; changed active threads are adopted.
- Successor adoption clears historical approval errors and CTAs.
- RED: changed thread remained `Stopping`, successor Stop was missing, and a
  historical approval CTA leaked into the successor turn.

### 009: cancel-outcome canonical reconciliation

- Successful canceled/completed/failed outcomes and ambiguous cancel failures
  converge through one canonical reconciliation state.
- Exact old active turns are restored only when confirmed; terminal state goes
  idle, successors are adopted, and reload failure remains non-repeatable with
  Retry thread load.
- RED: canceled missed successor, rejected response missed server cancellation,
  exact-old active was not reloaded, and reload failure had no retry path.

### 010: persist-intent transition

- Published an exact full-job persist transition before awaiting the pending
  database update.
- Running jobs treat a transition as pending; success merges the durable intent
  before removing its token; failure removes only that token.
- RED: the race produced `queued -> pending -> success`, persisted success,
  fresh retry count 0, and no restarted job. The fixed path remains pending and
  restart discovers both original and new paths.

## Signed implementation commits

All pushes were normal non-force pushes to
`refs/heads/docs/task-24-psychiatrist-plan`.

- `c5a2f22fba4be710950912733d11b1f5627a1a59` — `fix: resolve psychiatrist review races`
- `07cfce016118f6c0a9f2e6c861cd11f2ffdf9b17` — `fix: preserve failed backup intents`
- `dd706c894884a60413c95f2e1ef77a2bcdec3dac` — `fix: reconcile psychiatrist stop races`
- `3998756d74914116d4261e9c79b6171730bcdcfb` — `fix: reconcile changed psychiatrist threads`
- `6939eaf5984189be581704bbd298909081f19e26` — `fix: reconcile psychiatrist cancel outcomes`
- `0b567edfffd793a56c570388d0d8e3841684b9d2` — `fix: guard backup intent persistence`

Sawyer verified good signatures from configured key
`34DA85F7D6AC9041` for every commit. Local HEAD and the remote target ref were
verified after every push.

## Verification record

Final code-head verification:

- `mise exec -- bun run verify`
  - 117 test files passed;
  - 1070 tests passed;
  - 5 tests remain explicitly todo;
  - production build passed.
- `mise exec -- bun run test:e2e`
  - 71/71 Playwright tests passed at `0b567ed`.
- `TRAUMA_DEV_PORT=63931 TRAUMA_HMR_PORT=24931 mise exec -- bun run dev:smoke`
  - `/memories` responded successfully.
- backup-focused final suite
  - 52/52 passed.
- reader-focused final suite
  - 34/34 passed.
- component/request suite
  - 46/46 passed.
- `git diff --check`
  - passed.

The build continues to emit the existing non-blocking Node `DEP0155` warning
from `defuddle` through `temml`. Playwright also reports the existing
`NO_COLOR`/`FORCE_COLOR` warning. All commands exit successfully.

## Local review and agent record

Independent detached worktrees were created at each pushed review baseline.
Read-only lanes covered:

- backup concurrency, durable intent, finalizer failure, and Regenerate
  provenance;
- terminal publication, SSE replay, crash recovery, cancellation repair, and
  `Last-Event-ID`;
- UI turn lifecycle, Stop/cancel races, approval retry, thread identity,
  accessibility, and real EventSource behavior.

Confirmed findings were returned to fresh Revy TDD units. The parent reviewed
the resulting diffs and verification evidence. Sawyer alone staged, created
signed commits, pushed, and verified the remote ref. The final detached backend
and UI acceptance reviews at `0b567ed` both reported no actionable finding.

## Final GitHub state before this report-only commit

- Code head: `0b567edfffd793a56c570388d0d8e3841684b9d2`
- Mergeable: yes
- Unresolved review threads: 0
- CodeRabbit: passed
- GitHub Actions Verify: [passed in 3m03s](https://github.com/hauntedfail/Trauma/actions/runs/29211290135/job/86699333960)
- Re-review/trace comment: [4952725751](https://github.com/hauntedfail/Trauma/pull/30#issuecomment-4952725751)

This report is the only change after the reviewed code head. Its commit and
resulting documentation-only CI run are verified separately during final
handoff.
