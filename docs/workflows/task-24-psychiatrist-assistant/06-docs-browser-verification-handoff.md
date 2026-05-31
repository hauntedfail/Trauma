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
- State that session creation loads context and message turns stream through
  TRAUMA SSE.
- State that no memory content or SQLite state is modified by chat.

`docs/architecture/ui-and-routing.md`:

- Add reader-only Psychiatrist surface for `/memories/:id` and
  `/memories/:langCode/:id`.
- State that it is hidden from browse, flashbacks, settings, and shell-only
  surfaces.

`docs/references/design-system/reader-and-content.md`:

- Add the floating home-bar dock and expanded chat panel visual contract.
- Include reduced-motion and mobile viewport behavior.

`docs/references/configuration.md`:

- Update the Codex app-server section so it covers translation and
  Psychiatrist as backend-only consumers.

`docs/references/glossary.md`:

- Add `Psychiatrist` as TRAUMA product language for a memory-scoped assistant.

`docs/workflows/README.md`:

- After implementation lands, move Task 24 out of the active table and archive
  this workflow.

## Verification Commands

Focused:

```bash
mise exec -- bun run test tests/server/translation/codex-app-server.test.ts
mise exec -- bun run test tests/server/psychiatrist/context.test.ts tests/server/psychiatrist/prompt.test.ts tests/server/psychiatrist/api-routes.test.ts tests/server/psychiatrist/events.test.ts tests/server/psychiatrist/sessions.test.ts
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
- A real or fake Codex streamed answer appears in the transcript.
- Stale-session recovery asks for or creates a fresh session before resending.

## PR Handoff Requirements

The PR body must include:

- One-paragraph product behavior summary.
- API route list.
- Statement that no SQLite persistence or canonical memory writes were added.
- Exact verification commands and outcomes.
- Browser viewport evidence for desktop and mobile.
- Known limitations: sessions are in-memory and transcripts are not persisted.

## Acceptance Criteria

- Durable project docs describe Psychiatrist at the architecture, routing,
  design-system, configuration, and glossary levels.
- Verification covers server, component, build, and browser behavior.
- The PR makes clear that Psychiatrist is memory-scoped and reader-only.
