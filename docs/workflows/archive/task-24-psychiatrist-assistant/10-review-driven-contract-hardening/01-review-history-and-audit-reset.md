# 24.10.1 Review History And Audit Reset

## Goal

Create a trustworthy review intake before more implementation work. The output
is a deduplicated issue matrix, a corrected completion-audit state, and a gate
that prevents repeating resolved fixes without proof.

## Files Owned

- Modify: `docs/workflows/archive/task-24-psychiatrist-assistant/09-completion-audit.md`
- Modify: `docs/workflows/archive/task-24-psychiatrist-assistant/README.md`
- Modify: files in `docs/workflows/archive/task-24-psychiatrist-assistant/10-review-driven-contract-hardening/`

Do not edit application code in this subtask.

## Review Intake Contract

Before coding any 24.10 child workflow, collect current PR review state from
GitHub and classify every non-outdated review comment into one domain:

| Domain | Meaning | Expected Follow-up |
| --- | --- | --- |
| D1 citation URL projection | Source URLs may leak credentials, signatures, fragments, or unsafe hosts. | 24.10.2 |
| D2 Codex turn identity | Reused app-server threads can accept notifications for the wrong or unknown turn. | 24.10.3 |
| D3 terminal state precedence | Completed, failed, and canceled states race or overwrite each other. | 24.10.4 |
| D4 regenerate server projection | Regenerate failures need durable pair and retry projection. | 24.10.5 |
| D5 reader regenerate projection | Partial regenerate deltas hide the previous completed answer too early. | 24.10.6 |
| D6 stream/process safety | Visible process events require a declared allowlist and replay contract. | 24.10.7 |
| D7 handoff mechanics | Inline replies, duplicate closure, checks, and PR readiness are incomplete. | 24.10.8 |

Two comments are duplicates only when they point at the same underlying contract
failure, not merely the same file. Duplicate comments must be recorded together
and fixed by one workflow. Reply to each duplicate thread after the fix, naming
the shared contract and the verification that proves it.

## Known Reopened Review Items

Use current GitHub state as the source of truth, but the 2026-06-05 intake must
at least account for these review-derived issues:

- Duplicate unresolved comments requiring turn ids before accepting text
  completions in `src/server/translation/codex-app-server.ts`.
- Regenerate UI replacing the old completed answer before the regenerate turn
  completes in `src/components/reader/psychiatrist-transcript.ts`.
- Regenerate web-source approval state not surviving reload from thread storage
  in `src/server/psychiatrist/thread-store.ts`.
- Stop racing a failed turn and obscuring the failed terminal state in
  `src/server/psychiatrist/thread-store.ts`.
- Source citation sanitization implemented as short query-token deletion rather
  than a declared URL projection policy.

## Completion-Audit Reset Requirements

`09-completion-audit.md` must:

- keep the historical verification evidence intact;
- state that the old no-missing conclusion is superseded;
- link each reopened gap to the 24.10 child workflow that owns it;
- avoid claiming Task 24 completion until 24.10 finishes;
- avoid embedding implementation detail that belongs in child workflows.

## Verification

Run after the docs reset:

```bash
git diff --check
rg -n "24.10|superseded|Reopened Missing" docs/workflows/archive/task-24-psychiatrist-assistant
```

PR review metadata must also be refreshed before coding starts:

```bash
gh pr view 31 --json number,state,isDraft,headRefName,baseRefName,headRefOid,reviewDecision,mergeStateStatus
gh api graphql -f query='query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100){nodes{id,isResolved,isOutdated,comments(first:20){nodes{id,path,line,body,author{login},url}}}}}}}' -f owner=hauntedfail -f repo=Trauma -F number=31
```
