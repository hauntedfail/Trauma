# PR #30 Psychiatrist review response and local implementation audit

Date: 2026-07-13 JST
Pull request: [#30 docs: plan psychiatrist workflow](https://github.com/hauntedfail/Trauma/pull/30)
Head branch: `docs/task-24-psychiatrist-plan`
Dedicated worktree: `/private/tmp/trauma-pr30-review-followup-20260712`

## Outcome

The merged Psychiatrist implementation was reviewed in two passes:

1. EDA review-thread discovery, adjudication, fixes, inline replies, reactions,
   resolution, signed commits, push, and CI follow-up.
2. A separate local security, backend/state/storage, and frontend/UI review,
   followed by ordered red-green fixes for every confirmed finding.

At the final implementation head `41cece3351af1d4ecce7a6a4223138938b3b90ea`:

- all GitHub review threads are resolved;
- the fresh GraphQL thread sweep returns zero unresolved threads;
- the local branch and live PR head match;
- the implementation and E2E verification suites pass;
- commits were signed and pushed normally without history rewriting.

The durable EDA execution packet is intentionally ignored by Git and remains at:

`.eda/n30/001/001_merged_psychiatrist_review/`

## GitHub review response

The initial canonical sweep found six unresolved, non-outdated review threads.

| Review comment | Adjudication | Result |
| --- | --- | --- |
| [3446962188](https://github.com/hauntedfail/Trauma/pull/30#discussion_r3446962188) | Already fixed | Verified same-pair approved Regenerate retry and its regression coverage; replied, reacted, resolved. |
| [3446962190](https://github.com/hauntedfail/Trauma/pull/30#discussion_r3446962190) | Already fixed | Verified structured `webSourceRequired` handling without answer-text parsing; replied, reacted, resolved. |
| [3446962191](https://github.com/hauntedfail/Trauma/pull/30#discussion_r3446962191) | Must fix | Made public thread reads memory-scoped with a direct owning-memory lookup and cross-memory 404 regression; replied, reacted, resolved. |
| [3446962193](https://github.com/hauntedfail/Trauma/pull/30#discussion_r3446962193) | Must fix | Deferred route assertions until their owning workflow stages create those routes; replied, reacted, resolved. |
| [3446962195](https://github.com/hauntedfail/Trauma/pull/30#discussion_r3446962195) | Must fix | Clarified that transcript/domain data stays out of SQLite while built-in backup status bookkeeping remains allowed; replied, reacted, resolved. |
| [3446962198](https://github.com/hauntedfail/Trauma/pull/30#discussion_r3446962198) | Already fixed | Verified retry reconstruction enumerates all Psychiatrist thread artifacts; replied, reacted, resolved. |

The first implementation commit was:

- `12a932bfb2fa1196126fac560dc4dd86fd11a7d5` — `fix: scope psychiatrist thread reads to memories`

Its first CI run exposed only E2E fixture-level SQLite read contention after the
Moment POST had succeeded. The fix added a readonly-connection
`PRAGMA busy_timeout = 5000` without changing production database behavior:

- `19f44845a6d7ca3f950a3bc48ff399f3aa3f51fa` — `test: tolerate sqlite contention in e2e fixture`

The exact failed E2E repeated 10/10 successfully after the change, the full E2E
suite passed, and the rerun became green.

## Local implementation and security audit

Independent read-only lanes reviewed the exact `19f44845` baseline for:

- Codex runtime isolation and untrusted prompt/transcript boundaries;
- backend state machines, persistence, crash recovery, replay, and backup;
- frontend turn ownership, lifecycle, responsive layout, and accessibility.

The parent review also traced active-variant identity and public API lookup
boundaries. Confirmed findings and accepted fixes were executed sequentially by
fresh Revy units.

### 004: fail closed without an externally enforced runtime boundary

Codex `readOnly` prevents writes but does not remove shell or host-file reads.
Production message and Regenerate handlers now return
`503 runtime_isolation_required` before reservation or storage work unless the
operator makes the exact external-isolation assertion. Injected fake clients
remain testable.

The configuration and self-hosting docs explicitly state that the assertion
does not create or inspect a sandbox. Operators must independently ensure that
home, project, and store roots are unreadable and egress is constrained to
public HTTP(S) destinations.

### 005: active variant identity and bounded public APIs

Source and translated sessions now use active content hash, variant kind,
language, translation output hash, source hash, and prompt-policy version as
their resume identity.

Message, Regenerate, cancel, read, and replay routes are nested under the
owning memory/thread path. Cross-memory and cross-variant requests fail before
Codex, writes, backup, or cancellation. Pair and replay lookup use direct store
paths; no Psychiatrist `scanSync()` remains.

### 006: completion, backup intent, and crash recovery

The backup queue now has a two-phase durability boundary:

- `persistIntent()` creates retry-eligible durable state without starting a worker;
- completion persists the full answer/turn/replay set;
- final enqueue records queued state before terminal publication and worker execution.

Startup recovery treats a completed PAIRS revision for the same turn as
authoritative. It repairs first-answer and Regenerate turn records, terminal
replay, and thread projection instead of rewriting a saved answer as an
interrupted failure.

### 007: JSONL torn-tail recovery

PAIRS and stream journals now recover only an invalid, unterminated final
fragment. Complete or interior corruption continues to fail hard. The next
stream event ID is derived from valid rows and remains monotonic after repair,
including when the process cache is warm.

### 008: UI turn lifecycle isolation

Successful Stop disconnects and invalidates the old stream. Stream callbacks
must match reader, thread, stream, and current-turn generations before they can
change running state. Deferred load/send/Regenerate/Stop continuations ignore
disposed or changed reader generations. Component cleanup disconnects only and
does not cancel server work.

### 009: phone layout and prompt accessibility

The fixed dock clears the 4.75rem phone tab bar plus the shared safe-area token
through 720px and preserves the desktop bottom spacing. The prompt textarea now
has a real visually hidden `Message Psychiatrist` label.

The combined local-audit implementation was signed and pushed as:

- `4561918fe29542006dedad6c7c0fbaa41e978539` — `fix: harden psychiatrist runtime boundaries`

## Final post-push review sweep

A fresh sweep after `4561918` found four additional unresolved threads.

Two were already fixed by the active-variant/API work and were replied to,
reacted to, and resolved:

- [3566362003](https://github.com/hauntedfail/Trauma/pull/30#discussion_r3566362003) — translated thread identity;
- [3566362005](https://github.com/hauntedfail/Trauma/pull/30#discussion_r3566362005) — memory-scoped message sends.

Two were valid and received new red-green fixes:

### 010: direct-send prompt-policy freshness

[3566362007](https://github.com/hauntedfail/Trauma/pull/30#discussion_r3566362007)
showed that a browser could directly send to an old-policy manifest. The route
now compares `policyVersion` before reservation, ID generation, context, Codex,
stream, artifact, or backup work. It marks the thread stale and returns the
stable refresh response. The pre-fix regression returned 202 instead of 409.

### 011: structured process-event allowlist

[3566362010](https://github.com/hauntedfail/Trauma/pull/30#discussion_r3566362010)
showed that blacklist filtering could still persist arbitrary app-server text.
Only three exact `{kind, status: "started"}` pairs are now accepted and mapped
to fixed TRAUMA-owned strings. Unknown, missing, text-bearing, or extra/raw
payload fields are ignored; arbitrary message, summary, status, source, and
backend text cannot reach `psychiatrist.process.delta` persistence.

These final review fixes were signed and pushed as:

- `41cece3351af1d4ecce7a6a4223138938b3b90ea` — `fix: close psychiatrist review gaps`

Both comments received inline replies and reactions, both threads were
resolved, and the final GraphQL sweep returned zero unresolved threads.

## Verification record

Final local verification at `41cece3`:

- `mise exec -- bun run verify`
  - 117 test files passed;
  - 1048 tests passed;
  - 5 tests remain explicitly todo;
  - production build passed.
- `GIT_CONFIG_GLOBAL=/dev/null mise exec -- bun run test:e2e`
  - 56/56 Playwright tests passed.
- `tests/server/psychiatrist/api-routes.test.ts`
  - 64/64 passed after the policy-freshness change.
- `tests/server/translation/codex-app-server.test.ts`
  - 37/37 passed with host permission for its temporary Unix listener.
- `git diff --check`
  - passed.

The build continues to emit the existing non-blocking Node `DEP0155` warning
from `defuddle` through `temml`; all verification commands exit successfully.

Remote verification and signing:

- Sawyer verified good GPG signatures using configured key
  `34DA85F7D6AC9041`.
- Every push was a normal non-force push to
  `refs/heads/docs/task-24-psychiatrist-plan`.
- No remote history was rewritten and no excluded working-tree content was
  staged or deleted.

## Residual operational constraints

- `TRAUMA_PSYCHIATRIST_RUNTIME_ISOLATION` is an operator assertion, not a
  sandbox implementation. Psychiatrist production turns must remain disabled
  until the app-server is independently isolated from readable host roots and
  non-public egress.
- Legacy arbitrary-text `item/process` notifications and structured process
  notifications with unapproved extra metadata are intentionally dropped.
  New process states require explicit kind/status approval and a fixed display
  mapping.
- Chromium reports a zero safe-area inset in the current Playwright
  environment. Nonzero safe-area behavior is protected by the shared CSS token
  and static contract rather than device-inset emulation.

## Final PR state

- PR: [#30](https://github.com/hauntedfail/Trauma/pull/30)
- Head: `41cece3351af1d4ecce7a6a4223138938b3b90ea`
- Unresolved review threads: `0`
- CodeRabbit: passed
- GitHub Actions Verify: [passed in 2m49s](https://github.com/hauntedfail/Trauma/actions/runs/29202691844/job/86676626232)
