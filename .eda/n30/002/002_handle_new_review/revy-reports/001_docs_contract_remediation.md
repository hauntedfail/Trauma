# Revy Report: Docs Contract Remediation

Status: success

## Files Changed

- `docs/workflows/task-24-psychiatrist-assistant/README.md`
- `docs/workflows/task-24-psychiatrist-assistant/02-memory-context-and-prompt-contract.md`
- `docs/workflows/task-24-psychiatrist-assistant/03-thread-storage-api-and-streaming-events.md`
- `docs/workflows/task-24-psychiatrist-assistant/04-reader-floating-dock-and-chat-ui.md`
- `docs/workflows/task-24-psychiatrist-assistant/05-safety-freshness-and-errors.md`
- `docs/workflows/task-24-psychiatrist-assistant/07-psychiatrist-skill-and-runtime-policy.md`
- `docs/workflows/task-24-psychiatrist-assistant/08-streaming-continuity-regenerate-backup.md`
- `.eda/n30/002/002_handle_new_review/revy-reports/001_docs_contract_remediation.md`

## Exec-Plan Comparison

The assigned six contract remediations are represented in the allowed Task 24 docs:

1. `network_permission_required` is documented as a terminal waiting-for-approval pair status in 24.2, 24.3, 24.5, and 24.7, distinct from `pending`, `failed`, `canceled`, and `stale`. 24.3 also requires denied-network rows to use `status: "network_permission_required"` and `revision_kind: "network_permission_required"`.
2. `CONTEXT.json` now must persist selected Markdown text or exact rendered prompt input sufficient to reconstruct original Codex input after memory edits in 24.2, 24.3, and 24.8, with tests/acceptance criteria updated.
3. `pairId` is explicitly required to be an opaque generated UUID v7 for route and filesystem path segments in 24.3, with tests for rejecting derived ids.
4. Pair projection/reducer semantics now preserve the latest completed assistant response while overlaying failed, stopped, or network-permission-required Regenerate attempt status in 24.3, 24.4, 24.5, and 24.8.
5. Regenerate is scoped to active memory, thread, pair, and variant identity using `POST /api/memories/:memoryId/psychiatrist/threads/:threadId/pairs/:pairId/regenerate`; related helper/tests were updated in 24.3, 24.4, and 24.8.
6. Task 24 execution order now places 24.7 before 24.2/24.3/24.5 and 24.6 last in the README table while preserving task ids and filenames.

Review refinement: read-thread, event, and cancel route docs were restored to their prior global routes. Only Regenerate remains scoped by active memory, thread, pair, and variant identity.

Final comparison is against `.eda/n30/002/002_handle_new_review/parent-exec-plan.md` and the review follow-up handoff.

## Verification

- Passed: `git diff --check`
- Passed: focused positive `rg` scan confirmed the updated contract terms across the edited Task 24 docs.
- Passed: focused negative `rg` scan for stale global Regenerate route/helper/provenance strings found no matches in the edited docs.
- Passed: focused route `rg` scans confirmed read-thread/event/cancel docs use global routes while Regenerate keeps the scoped route.

## Blockers

- None for this bounded docs remediation.
