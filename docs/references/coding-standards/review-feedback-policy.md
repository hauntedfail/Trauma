# Review Feedback Policy

This document defines how valid review feedback becomes durable project
knowledge. It is not a PR changelog and should not collect issue-specific
mistakes.

The default durable artifact is a check, not prose.

## Triage

| Review finding type | First durable artifact | Documentation role |
| --- | --- | --- |
| One-off bug | Regression test for the failing behavior | None unless the bug reveals an undocumented invariant |
| Repeated style issue | Linter, formatter, typecheck, or static check | Short rule explaining the automated check |
| Architecture invariant | Contract test, integration test, or static check | Architecture/reference doc for the invariant |
| Agent navigation issue | Clearer map or pointer | `AGENTS.md` stays short and links to the owning doc |
| Workflow failure | Script, CI job, workflow checklist, or PR template | Workflow doc when humans must follow a sequence |
| Reviewer false positive | Reviewer config, ignore rule, or reply with evidence | None unless the false positive exposed unclear architecture |

## Rules

- MUST add or update a test/check before adding prose when the failure is
  machine-checkable.
- MUST NOT add PR numbers, commit IDs, reviewer names, or incident narratives to
  coding standards.
- MUST generalize any retained guidance into a stable rule that applies beyond
  the triggering PR.
- MUST write retained review knowledge semantically, not episodically. Prefer
  rules about generally recurring design or implementation tendencies over
  descriptions of what happened in one case.
- MUST keep `AGENTS.md` as navigation only. Put details in the smallest owning
  doc and link to that doc.
- MUST keep workflow failures in workflow documentation or automation, not in
  architecture or coding-standard files.
- SHOULD prefer deletion over accumulation when older review guidance is
  replaced by tests, static checks, or clearer architecture.
- SHOULD record false positives in tool configuration or reviewer instructions,
  not in human-facing implementation rules.

## When Prose Is Justified

Prose belongs in durable docs only when it captures an invariant that cannot be
fully enforced by the current toolchain, or when it explains why a check exists.
The prose should name the rule and owner, not the PR that discovered it.
