# 24.6 Docs, Browser Verification, And Handoff

## Goal

Document the durable Psychiatrist contracts, verify the reader experience in a
browser, and prepare the PR handoff with exact evidence.

## Files Likely Owned

- Modify: `docs/architecture/flows.md`
- Modify: `docs/architecture/ui-and-routing.md`
- Modify: `docs/references/configuration.md`
- Modify: `docs/references/design-system/reader-and-content.md`
- Modify: `docs/references/glossary.md`
- Modify: `docs/workflows/README.md`
- Test: `tests/components/psychiatrist-dock.test.tsx`
- E2E: `e2e/reader.spec.ts`
- E2E: `e2e/cross-device-responsive.spec.ts`

## Documentation Updates

`docs/architecture/flows.md`:

- Add a memory-scoped Psychiatrist flow.
- State that thread creation loads context and prompt/response pair turns stream through
  TRAUMA SSE.
- State that user prompts and Psychiatrist answers are stored under
  `{storePath}/memories/{memoryId}/threads/{threadId}/PAIRS.jsonl`, not
  SQLite.
- State that every durable assistant answer belongs to one stored user prompt in
  the same pair.
- State that Psychiatrist Codex app-server turns deny shell access, local file
  editing, local filesystem browsing, project/store filesystem roots, and
  unapproved network access.
- State that canonical memory content, translated content, taxonomy,
  Flashbacks, Moments, and SQLite state are not modified by chat.

`docs/architecture/ui-and-routing.md`:

- Add reader-only Psychiatrist surface for `/memories/:id` and
  `/memories/:langCode/:id`.
- State that it is hidden from browse, flashbacks, settings, and shell-only
  surfaces.

`docs/references/design-system/reader-and-content.md`:

- Add the floating home-bar dock and expanded chat panel visual contract.
- State that the dock resumes stored memory-local thread pairs when the thread
  API returns them.
- Add the per-turn web-source permission UI state for
  `network_permission_required`.
- Include reduced-motion and mobile viewport behavior.

`docs/references/configuration.md`:

- Update the Codex app-server section so it covers translation and
  Psychiatrist as backend-only consumers.
- Document that Psychiatrist does not add shell/file access configuration.
  Network access is per-turn and user-approved only.

`docs/references/glossary.md`:

- Add `Psychiatrist` as TRAUMA product language for a memory-scoped assistant.

`.agents/skills/psychiatrist/SKILL.md`:

- Document the assistant's durable behavior policy, including memory-only
  scope, pair discipline, no medical role, no writes, no shell/file access, and
  user-approved web-source access only.

`docs/workflows/README.md`:

- After implementation lands, move Task 24 out of the active table and archive
  this workflow.

## Verification Commands

Focused:

```bash
mise exec -- bun run test tests/server/translation/codex-app-server.test.ts
mise exec -- bun run test tests/server/psychiatrist/context.test.ts tests/server/psychiatrist/prompt.test.ts tests/server/psychiatrist/api-routes.test.ts tests/server/psychiatrist/events.test.ts tests/server/psychiatrist/thread-store.test.ts tests/server/psychiatrist/threads.test.ts
mise exec -- bun run test tests/components/psychiatrist-dock.test.tsx tests/components/memory-reader-actions.test.ts
```

Full:

```bash
mise exec -- bun run typecheck
mise exec -- bun run test
mise exec -- bun run build
mise exec -- bun run test:e2e e2e/reader.spec.ts e2e/cross-device-responsive.spec.ts
```

Browser:

```bash
codex app-server --listen unix://
TRAUMA_CODEX_APP_SERVER_ENDPOINT=unix:// mise exec -- bun run dev
```

Then verify:

- Source reader shows collapsed Psychiatrist home bar.
- Translated reader shows collapsed Psychiatrist home bar.
- Browse route does not show Psychiatrist.
- Chat expands and collapses with animation.
- Reduced-motion emulation removes transform-heavy animation.
- A real or fake Codex streamed answer appears in the transcript and is written
  under the active memory's `threads/` subtree as one prompt/response pair.
- Stale-thread recovery asks for or creates a fresh thread before resending.
- A network-required response does not use web access before approval.
- A user-approved web-source retry records source metadata on the pair.

## PR Handoff Requirements

The PR body must include:

- One-paragraph product behavior summary.
- API route list.
- Statement that prompts and answers are persisted as pair records under
  memory-local `threads/` storage, not SQLite.
- Statement that no canonical memory content writes were added outside
  Psychiatrist thread artifacts.
- Statement that Psychiatrist is governed by the repo-local `psychiatrist`
  skill policy and the deterministic runtime prompt mirrors it.
- Statement that app-server turns have no shell/local-file access and no
  network access unless the user approves web-source lookup for that turn.
- Exact verification commands and outcomes.
- Browser viewport evidence for desktop and mobile.
- Known limitations: this workflow does not add archive-wide thread browse,
  thread deletion UI, or cross-memory retrieval.

## Acceptance Criteria

- Durable project docs describe Psychiatrist at the architecture, routing,
  design-system, configuration, and glossary levels.
- Verification covers server, component, build, and browser behavior.
- The PR makes clear that Psychiatrist is memory-scoped and reader-only.
