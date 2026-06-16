# PR #30 New Review Remediation Plan

## Metadata

- PR: https://github.com/hauntedfail/Trauma/pull/30
- Trigger: `handle the new review`
- Mode: `parent-only`
- Run directory: `/private/tmp/trauma-pr30-review-docs/.eda/n30/001/001_handle_new_review`
- Worktree: `/private/tmp/trauma-pr30-review-docs`
- Local branch: `cc/pr30-review-docs`
- Remote target: `origin docs/task-24-psychiatrist-plan`
- Base/head at discovery: `main` -> `c4ce40fae9655f9e071beafc71896b648479b2af`

## Shared Constraints

- Preserve unrelated changes in `/Users/vvx/projekt/www/trauma`; implementation happens only in this isolated worktree.
- Do not force-push, rewrite remote history, or use destructive ref updates.
- Scope is documentation contract fixes for Task 24 Psychiatrist workflow only.
- Mutating implementation work belongs to one fresh Revy via `two-hand`.
- Git staging, signed commit, and push belong to Sawyer.

## Project Context

- `AGENTS.md` says start with `docs/INDEX.md`, keep docs aligned to architecture/reference/quality/workflow maps, and use Sawyer for finalization.
- PR #30 is documentation-only planning work for Task 24 Psychiatrist Memory Assistant.
- The review comments target contract drift across `01`, `02`, `03`, `05`, `07`, and `08` workflow docs.

## Adjudication

| Item | URL | Decision | Classification | Evidence And Implementation Implication |
| --- | --- | --- | --- | --- |
| Scope message sends to the active memory | https://github.com/hauntedfail/Trauma/pull/30#discussion_r3342530695 | Valid | must_fix | `03` currently documents `POST /api/psychiatrist-threads/:threadId/messages` with only `threadId`; yet tests require cross-memory rejection. Make message send memory-scoped or include active memory/variant so stale component state can be rejected before context building. |
| Replay turn events for late EventSource connections | https://github.com/hauntedfail/Trauma/pull/30#discussion_r3342530705 | Already satisfied by later durable stream work, with handoff gap handled separately below | already_fixed | Current `03` and `08` persist `streams/{turnId}.jsonl` and replay after navigation/reload. The later handoff-gap comment is still valid and must be fixed. |
| Do not persist ephemeral Codex thread ids | https://github.com/hauntedfail/Trauma/pull/30#discussion_r3342530710 | Valid | must_fix | `03` still stores latest app-server thread id in `THREAD.json`. The docs also say app-server ids are unreliable after restart. Persist app-server ids only as transient active-turn metadata or recreate them from stored transcript on resume. |
| Add a retry target for approved web-source turns | https://github.com/hauntedfail/Trauma/pull/30#discussion_r3343447066 | Valid | must_fix | `network_permission_required` retry currently sends only permission and prompt. Add explicit same-pair retry target so the approved turn completes the original pair instead of creating an unrelated pair. |
| Include policy version in thread freshness | https://github.com/hauntedfail/Trauma/pull/30#discussion_r3343447071 | Valid | must_fix | `07` introduces `PSYCHIATRIST_PROMPT_POLICY_VERSION`, but `resume_latest` in `03` only matches memory/variant/content hash. Include policy version in thread manifests and freshness matching. |
| Treat stored pair history as untrusted prompt data | https://github.com/hauntedfail/Trauma/pull/30#discussion_r3343447075 | Valid | must_fix | `02` says memory Markdown is untrusted but does not explicitly lock prior user prompts as untrusted transcript data. Add this to prompt policy and tests. |
| Separate app-server turn ids from public turn ids | https://github.com/hauntedfail/Trauma/pull/30#discussion_r3343447081 | Valid | must_fix | `01` names adapter result fields `threadId` and `turnId`, which conflicts with TRAUMA public ids. Rename adapter-facing fields to app-server-specific names and update downstream docs. |
| Allow server writes for required thread artifacts | https://github.com/hauntedfail/Trauma/pull/30#discussion_r3343523476 | Valid | must_fix | `05` allows only `THREAD.json`, `PAIRS.jsonl`, and `turns/{turnId}.json`, but `03` and `08` require `THREAD.md`, `PROMPT.md`, `CONTEXT.json`, `RESPONSE.md`, and stream JSONL writes. Align the runtime boundary. |
| Allow Regenerate to use its stored context | https://github.com/hauntedfail/Trauma/pull/30#discussion_r3343523485 | Valid | must_fix | `08` rejects stale pairs, which blocks same-pair Regenerate after memory changes even though Regenerate must use stored prompt/context. Allow stale-current-memory regenerate when stored provenance exists; still reject missing/cross-memory/non-completed/lacking-provenance pairs. |
| Close the replay-to-live SSE handoff gap | https://github.com/hauntedfail/Trauma/pull/30#discussion_r3343523491 | Valid | must_fix | `03` and `08` currently replay before subscribing. Specify an atomic replay-to-live handoff with subscription registration plus event-id de-duplication or an equivalent no-gap cursor protocol. |
| Write response artifacts before completing the pair | https://github.com/hauntedfail/Trauma/pull/30#discussion_r3343523495 | Valid | must_fix | `03` marks the pair complete before rewriting `RESPONSE.md`/`THREAD.md`. Make artifact writes or recovery happen before the canonical completed pair revision. |
| Make permission-to-runtime mapping explicit | https://github.com/hauntedfail/Trauma/pull/30#pullrequestreview-4412440990 | Valid | must_fix | `07` implies but does not define mapping between `web_source_permission`, `web_source_policy.reason`, and `networkAccess`. Add a normative mapping table and reference it from route, runtime, and tests. |

## Planning Mode

Use `parent-only`: all valid comments concern one coherent Task 24 Psychiatrist contract consistency update. The implementation touches multiple docs, but splitting would duplicate cross-file terminology decisions and increase drift risk.

## Revy Task

Assigned unit: update Task 24 Psychiatrist docs to satisfy every `must_fix` item above while preserving the existing product design.

Allowed files:

- `docs/workflows/task-24-psychiatrist-assistant/01-codex-conversation-adapter.md`
- `docs/workflows/task-24-psychiatrist-assistant/02-memory-context-and-prompt-contract.md`
- `docs/workflows/task-24-psychiatrist-assistant/03-thread-storage-api-and-streaming-events.md`
- `docs/workflows/task-24-psychiatrist-assistant/04-reader-floating-dock-and-chat-ui.md`
- `docs/workflows/task-24-psychiatrist-assistant/05-safety-freshness-and-errors.md`
- `docs/workflows/task-24-psychiatrist-assistant/07-psychiatrist-skill-and-runtime-policy.md`
- `docs/workflows/task-24-psychiatrist-assistant/08-streaming-continuity-regenerate-backup.md`

Expected contract updates:

- Message send route carries active memory identity and translated variant identity so cross-memory/cross-variant stale requests can be rejected.
- App-server ids are clearly named separately from TRAUMA `thread_id`/`turn_id` and are not durable manifest identity.
- Thread freshness includes prompt policy version.
- Prior pair history is untrusted transcript data and cannot override policy.
- Network-required approved retry targets the same pair explicitly.
- Server write boundary includes all required thread artifacts and durable stream files.
- Regenerate uses stored prompt/context even if current memory content changed; reject only missing/cross-memory/non-completed/lacking-provenance cases.
- SSE replay-to-live handoff is no-gap via subscribe-before-or-atomic cursor with event-id de-duplication.
- Response/projection artifacts are written or recoverable before a completed pair revision becomes canonical.
- `07` has a normative permission/policy/runtime mapping table and tests reference it.

Verification expected:

- `git diff --check`
- Markdown link check if available in repo tooling; otherwise targeted `rg` consistency checks are acceptable.
- `mise exec -- bun run typecheck` is optional for docs-only change if runtime setup is expensive, but run it if quick.

## Final Sweep Checklist

- [x] Revy implemented only the allowed docs files.
- [x] Eda reviewed diff against this plan and review comments.
- [x] Verification recorded.
- [ ] Sawyer staged only intended docs plus `.eda` run artifacts if useful, committed signed, and pushed to `docs/task-24-psychiatrist-plan`.
- [ ] Every review thread receives a concrete reply with commit SHA or no-change rationale.
- [ ] Fixed or already-fixed threads are resolved after replies.
- [ ] CodeRabbit nitpick receives a trace reply URL.
- [ ] PR checks/status are re-fetched.
- [ ] Re-review requested from Codex and CodeRabbit using repository-visible trigger comments.
