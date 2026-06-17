# PR #30 CodeRabbit Follow-Up Exec Plan

## Metadata

- PR: #30, https://github.com/hauntedfail/Trauma/pull/30
- Trigger: CodeRabbit follow-up after re-review request
- Run directory: `.eda/n30/003/003_handle_coderabbit_followup`
- Worktree: `/private/tmp/trauma-pr30-review-docs`
- Local branch: `cc/pr30-review-docs`
- Target remote ref: `origin/docs/task-24-psychiatrist-plan`
- Reviewed commit: `3e2ae1426f11a893483f9d756aac5b9dd168f37b`
- Planning mode: `parent-only`

## Review Inventory

The new actionable review is CodeRabbit review
https://github.com/hauntedfail/Trauma/pull/30#pullrequestreview-4512101465
against commit `3e2ae14`.

| Item | Thread | Comment | File | Claim | Classification | Outcome |
| --- | --- | --- | --- | --- | --- | --- |
| network-permission-transcript-handling | `PRRT_kwDOSYaxA86KF8wU` | https://github.com/hauntedfail/Trauma/pull/30#discussion_r3425401791 | `02-memory-context-and-prompt-contract.md` | Pair history test guidance is ambiguous about how `network_permission_required` pairs appear in the model transcript. | `must_fix` | Planned |
| regenerate-original-id-validation | `PRRT_kwDOSYaxA86KF8wY` | https://github.com/hauntedfail/Trauma/pull/30#discussion_r3425401795 | `02-memory-context-and-prompt-contract.md` | Regenerate tests should validate `originalPairId` and `originalTurnId` match the stored pair and turn being regenerated. | `must_fix` | Planned |

## Adjudication

Both comments are valid. The previous run added terminal
`network_permission_required` status/revision semantics and strengthened
Regenerate provenance, but the 24.2 test guidance still leaves two small
implementation choices implicit.

### network-permission-transcript-handling

- Reviewer claim: `network_permission_required` pairs are terminal but neither
  completed nor actively pending, so pair-history guidance must state whether
  and how they appear in the transcript.
- Author/design intent: Prompt history is pair-shaped and untrusted; blocked
  network turns should preserve the original user prompt and approval state
  without inventing an assistant response.
- Requirement evidence: 24.2 defines pair history in prompts; 24.3 defines
  `network_permission_required` rows without `assistant_response`; 24.4/24.5
  require UI approval to retry the same pair.
- Current behavior: tests mention completed pairs/current pending pair but do
  not explicitly include terminal waiting-for-approval pairs.
- Decision: valid, `must_fix`.
- Implementation implication: update 24.2 tests/guidance so prompt output
  includes the original user message for `network_permission_required` pairs,
  clearly delimited as untrusted transcript data and marked as awaiting
  user-approved web-source access, without fabricating assistant content.

### regenerate-original-id-validation

- Reviewer claim: Regenerate tests should explicitly assert
  `originalPairId`/`originalTurnId` match the stored pair and turn.
- Author/design intent: Regenerate is same-pair and same-context only.
- Requirement evidence: 24.2 `PsychiatristRegenerateInput` contains original
  pair/turn ids; 24.3/24.8 require strict same-pair Regenerate.
- Current behavior: 24.2 tests say stored prompt/context for the same pair, but
  do not name id mismatch rejection.
- Decision: valid, `must_fix`.
- Implementation implication: update 24.2 test guidance to validate
  `originalPairId` and `originalTurnId` against the stored pair and turn and
  reject mismatches.

## Implementation Scope

Allowed docs:

- `docs/workflows/task-24-psychiatrist-assistant/02-memory-context-and-prompt-contract.md`

Allowed workflow artifacts:

- `.eda/n30/003/003_handle_coderabbit_followup/review-state.json`
- `.eda/n30/003/003_handle_coderabbit_followup/parent-exec-plan.md`
- `.eda/n30/003/003_handle_coderabbit_followup/revy-reports/001_prompt_tests_followup.md`
- `.eda/n30/003/003_handle_coderabbit_followup/verification.md`

Out of scope:

- Runtime TypeScript implementation files.
- Other Task 24 docs unless a direct wording link is necessary.
- Prior `.eda/n30/001` and `.eda/n30/002` artifacts.
- Package manifests, lockfiles, configs, generated output, and unrelated files.

## Parent-Only Task

One Revy task should update the 24.2 test guidance with minimal wording:

1. Explicitly state that `network_permission_required` pair history includes the
   original user prompt, is included only as untrusted transcript data, is marked
   as awaiting user-approved web-source access, and does not include fabricated
   assistant content.
2. Explicitly state that Regenerate tests validate
   `PsychiatristRegenerateInput.originalPairId` and `originalTurnId` against the
   actual stored pair id and turn id, and reject mismatches.

## Verification Plan

Run after Revy changes:

```bash
git diff --check
rg -n "network_permission_required|originalPairId|originalTurnId|awaiting|untrusted transcript" docs/workflows/task-24-psychiatrist-assistant/02-memory-context-and-prompt-contract.md
MISE_TRUSTED_CONFIG_PATHS=/private/tmp/trauma-pr30-review-docs/mise.toml mise exec -- bun run typecheck
```

## Final Sweep Checklist

- [ ] Revy completed and Eda reviewed its diff against this plan.
- [ ] `git diff --check` passed.
- [ ] typecheck passed or a blocker is recorded.
- [ ] Sawyer staged only intended files.
- [ ] Sawyer produced a signed commit and pushed to
  `origin docs/task-24-psychiatrist-plan`.
- [ ] Replies posted to both CodeRabbit review threads with commit SHA and
  validation.
- [ ] Reaction added to both original comments.
- [ ] Both threads resolved.
- [ ] GitHub sweep shows zero unresolved review threads.
- [ ] PR checks are passing before requesting re-review.

