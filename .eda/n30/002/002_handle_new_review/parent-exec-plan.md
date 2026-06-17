# PR #30 Review Follow-Up Exec Plan

## Metadata

- PR: #30, https://github.com/hauntedfail/Trauma/pull/30
- Trigger: `handle the new review`
- Run directory: `.eda/n30/002/002_handle_new_review`
- Worktree: `/private/tmp/trauma-pr30-review-docs`
- Local branch: `cc/pr30-review-docs`
- Target remote ref: `origin/docs/task-24-psychiatrist-plan`
- Reviewed commit: `ff607a23b1ef3a6993759546b6942e6ea33fedcf`
- Planning mode: `parent-only`

## Review Inventory

The new actionable review is Codex review
https://github.com/hauntedfail/Trauma/pull/30#pullrequestreview-4510506057
against commit `ff607a23b1`.

| Item | Thread | Comment | File | Claim | Classification | Outcome |
| --- | --- | --- | --- | --- | --- | --- |
| network-permission-pair-status | `PRRT_kwDOSYaxA86KCkjy` | https://github.com/hauntedfail/Trauma/pull/30#discussion_r3424176944 | `02-memory-context-and-prompt-contract.md` | Pair status cannot represent terminal `network_permission_required` after a denied turn. | `must_fix` | Planned |
| policy-before-prompt-work | `PRRT_kwDOSYaxA86KCkj1` | https://github.com/hauntedfail/Trauma/pull/30#discussion_r3424176952 | `README.md` | Policy skill/version/mapping is introduced after prompt/thread work and handoff is not last. | `must_fix` | Planned |
| regenerate-active-thread-scope | `PRRT_kwDOSYaxA86KCkj3` | https://github.com/hauntedfail/Trauma/pull/30#discussion_r3424176955 | `04-reader-floating-dock-and-chat-ui.md` | Regenerate helper carries only `pairId`, losing memory/thread/variant enforcement. | `must_fix` | Planned |
| preserve-response-after-failed-regenerate | `PRRT_kwDOSYaxA86KCkj5` | https://github.com/hauntedfail/Trauma/pull/30#discussion_r3424176957 | `03-thread-storage-api-and-streaming-events.md` | Pair reducer loses the prior completed response after failed/stopped Regenerate. | `must_fix` | Planned |
| full-context-regenerate-snapshot | `PRRT_kwDOSYaxA86KCkj-` | https://github.com/hauntedfail/Trauma/pull/30#discussion_r3424176963 | `02-memory-context-and-prompt-contract.md` | Snapshot stores anchors/hashes but not selected Markdown or exact prompt input. | `must_fix` | Planned |
| pair-id-path-segment-validation | `PRRT_kwDOSYaxA86KCkkD` | https://github.com/hauntedfail/Trauma/pull/30#discussion_r3424176966 | `03-thread-storage-api-and-streaming-events.md` | `pairId` is path/route input but is not covered by UUID/path-segment rules/tests. | `must_fix` | Planned |

## Adjudication

All six comments are valid. They do not ask for behavior outside Task 24's
scope; they expose contract gaps in the planning docs that would let a later
implementation violate memory scoping, path safety, Regenerate provenance, or
pair lifecycle invariants.

### network-permission-pair-status

- Reviewer claim: a denied turn that needs network permission is neither
  running nor ordinary failed/canceled, but the status union cannot express it.
- Author/design intent: Task 24 requires same-pair approved retry after
  `network_permission_required`.
- Requirement evidence: 24.3 already requires same-pair retry fields and 24.5
  treats network permission as a recoverable UI action.
- Current behavior: the 24.2 type allows only `pending`, `completed`, `failed`,
  `canceled`, and `stale`.
- Decision: valid, `must_fix`.
- Implementation implication: add `network_permission_required` pair status and
  storage/loading/test coverage.

### policy-before-prompt-work

- Reviewer claim: subtask order makes 24.2/24.3/24.5 guess policy/version
  contracts before 24.7 defines them, and 24.6 handoff is not final.
- Author/design intent: Task 24 treats the repo-local skill and policy version
  as the durable source for prompt and runtime behavior.
- Requirement evidence: README non-negotiable contracts and 24.7 define policy
  version, skill, and permission-to-runtime mapping used by earlier tasks.
- Current behavior: subtask table lists 24.7 after 24.6.
- Decision: valid, `must_fix`.
- Implementation implication: make the execution sequence run 24.7 immediately
  after 24.1 and before prompt/thread/safety/UI subtasks; move 24.6 to final
  handoff after 24.8. Preserve file names and task ids unless a wider rename is
  unavoidable.

### regenerate-active-thread-scope

- Reviewer claim: global pair-only Regenerate lets stale client state target a
  pair without active memory/thread/variant checks.
- Author/design intent: all Psychiatrist actions are scoped to one active
  memory variant and cross-memory requests must be rejected before Codex.
- Requirement evidence: message sends were already memory/thread scoped; the
  non-negotiable contracts require memory A threads to reject memory B prompts.
- Current behavior: 24.3 and 24.8 specify `POST
  /api/psychiatrist-pairs/:pairId/regenerate`; 24.4 helper only takes `pairId`.
- Decision: valid, `must_fix`.
- Implementation implication: nest Regenerate under
  `/api/memories/:memoryId/psychiatrist/threads/:threadId/pairs/:pairId/regenerate`
  or equivalently require `memoryId`, `threadId`, and active variant identity in
  the helper/request. Prefer route nesting for parity with message sends.

### preserve-response-after-failed-regenerate

- Reviewer claim: latest-row-only reduction hides the last completed answer
  after a later failed/stopped Regenerate row.
- Author/design intent: UI keeps the previous completed answer visible if
  Regenerate fails or is stopped.
- Requirement evidence: 24.4, 24.5, and 24.8 already state failed Regenerate
  leaves the prior completed response visible.
- Current behavior: 24.3 says thread loading keeps the latest complete revision,
  but does not clearly require carrying forward the response while overlaying
  failed/stopped regenerate status.
- Decision: valid, `must_fix`.
- Implementation implication: specify pair projection reducer semantics and
  tests: latest completed response is retained for display/prompt history,
  latest attempt status is overlaid for UI state and retry/cancel decisions.

### full-context-regenerate-snapshot

- Reviewer claim: anchors/hashes cannot reconstruct original context after
  memory edits; stored selected Markdown or exact rendered prompt input is
  needed.
- Author/design intent: Regenerate uses the stored prompt and stored context
  snapshot even after current memory content changes.
- Requirement evidence: README, 24.2, 24.5, and 24.8 require stored-context
  Regenerate.
- Current behavior: 24.2 and 24.3 snapshots record anchors/hashes/provenance but
  not selected Markdown or rendered prompt input.
- Decision: valid, `must_fix`.
- Implementation implication: require `CONTEXT.json` to persist selected section
  Markdown text or exact prompt input sufficient to reconstruct the original
  Codex input; update tests and acceptance criteria.

### pair-id-path-segment-validation

- Reviewer claim: `pairId` is used in paths/routes but not required to be a
  generated UUID/path segment.
- Author/design intent: all durable thread artifact ids are opaque generated
  identifiers, never user-derived paths.
- Requirement evidence: 24.3 stores artifacts under
  `pairs/{pairId}/...`; Regenerate/retry code takes `pairId` from requests.
- Current behavior: only `threadId` and `turnId` are explicitly required to be
  UUID v7 values.
- Decision: valid, `must_fix`.
- Implementation implication: add `pairId` to generated UUID/path-segment rules,
  route validation expectations, and tests.

## Shared Constraints

- Read and obey `AGENTS.md`, `docs/INDEX.md`, `docs/workflows/README.md`, and
  Task 24 docs.
- This PR is documentation-only planning work. Do not implement runtime code.
- Do not touch unrelated dirty files in `/Users/vvx/projekt/www/trauma`.
- Work only in `/private/tmp/trauma-pr30-review-docs`.
- Preserve prior `.eda/n30/001` artifacts.
- Never force-push or rewrite remote history.

## Implementation Scope

Allowed docs:

- `docs/workflows/task-24-psychiatrist-assistant/README.md`
- `docs/workflows/task-24-psychiatrist-assistant/02-memory-context-and-prompt-contract.md`
- `docs/workflows/task-24-psychiatrist-assistant/03-thread-storage-api-and-streaming-events.md`
- `docs/workflows/task-24-psychiatrist-assistant/04-reader-floating-dock-and-chat-ui.md`
- `docs/workflows/task-24-psychiatrist-assistant/05-safety-freshness-and-errors.md`
- `docs/workflows/task-24-psychiatrist-assistant/07-psychiatrist-skill-and-runtime-policy.md`
- `docs/workflows/task-24-psychiatrist-assistant/08-streaming-continuity-regenerate-backup.md`

Allowed workflow artifacts:

- `.eda/n30/002/002_handle_new_review/review-state.json`
- `.eda/n30/002/002_handle_new_review/parent-exec-plan.md`
- `.eda/n30/002/002_handle_new_review/revy-reports/`
- `.eda/n30/002/002_handle_new_review/verification.md`
- `.eda/n30/002/002_handle_new_review/github-replies.md`

Out of scope:

- Runtime TypeScript implementation files.
- Archived workflow docs.
- Package manifests, lockfiles, configs, generated output, and unrelated
  worktree files.

## Parent-Only Task

One Revy task should update the Task 24 planning docs so all six review findings
are resolved as one coherent contract pass:

1. Add explicit `network_permission_required` pair status/revision semantics to
   type contracts, storage rules, thread loading, retry behavior, and tests.
2. Require `CONTEXT.json` to persist selected Markdown text or exact prompt input
   needed to regenerate from original context after memory edits.
3. Require `pairId` to be an opaque generated UUID v7 path segment everywhere it
   is used in routes and filesystem paths.
4. Update the pair projection reducer to preserve the latest completed response
   while overlaying failed/stopped Regenerate attempt status.
5. Scope Regenerate requests with active memory, thread, and variant identity,
   preferably by nesting the route under memory/thread/pair.
6. Reorder the Task 24 execution sequence so policy/runtime skill work runs
   before prompt/thread/safety work and docs/browser handoff runs last.
7. Keep wording consistent across 24.2, 24.3, 24.4, 24.5, 24.7, and 24.8.

## Verification Plan

Run after Revy changes:

```bash
git diff --check
mise exec -- bun run typecheck
rg -n "network_permission_required|pairId|CONTEXT\\.json|regeneratePsychiatristResponse|psychiatrist-pairs|Subtask Order|24\\.7|24\\.6" docs/workflows/task-24-psychiatrist-assistant
```

Because this is a documentation-only PR update, focused text scans plus
typecheck are sufficient unless Revy changes executable code.

## Final Sweep Checklist

- [ ] Revy completed and Eda reviewed its diff against this plan.
- [ ] `git diff --check` passed.
- [ ] `mise exec -- bun run typecheck` passed or a blocker is recorded.
- [ ] Sawyer staged only intended files.
- [ ] Sawyer produced a signed commit when signing is configured.
- [ ] Sawyer pushed to `origin docs/task-24-psychiatrist-plan`.
- [ ] Replies posted to all six review threads with commit SHA and validation.
- [ ] A reaction was added to each fixed review comment when supported.
- [ ] All six review threads resolved.
- [ ] GitHub sweep shows zero unresolved non-outdated review threads from this
  run.
- [ ] PR checks are passing or a blocker is recorded.
- [ ] Re-review requested from Codex, CodeRabbit, and Copilot.

