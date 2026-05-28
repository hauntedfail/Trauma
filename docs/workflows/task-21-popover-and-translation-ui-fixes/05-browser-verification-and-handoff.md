# Task 21.5: Browser Verification and Handoff

## Goal

Verify the unified popover design and translation popover behaviour in browser
contexts, then prepare a reviewable PR handoff.

## Ownership

Primary files:

- Modify `docs/workflows/task-21-popover-and-translation-ui-fixes/README.md`
  only if implementation scope changes during execution
- Modify `docs/references/design-system/verification.md` if browser checks add
  durable visual criteria
- Do not modify product code in this subtask unless verification exposes a bug
  that belongs to Tasks 21.1-21.4

## Browser Checks

Use Playwright or browser automation against a local dev server.

Check these routes and widths:

- `/memories` desktop
- `/memories` mobile
- `/memories/:id` desktop reader route with translation target configured
- `/memories/:id` mobile reader route with translation target configured

Verify:

- Add memory popover uses the transparent elevated panel.
- Theme popover uses the transparent elevated panel.
- Action menus use the transparent elevated panel.
- Taxonomy selector popover uses the transparent elevated panel.
- Reader translation popover uses the shared transparent panel.
- The reader translation `Translate` button has active primary contrast.
- Clicking outside the reader translation popover closes it without starting a
  translation.
- Pressing Escape closes the reader translation popover without starting a
  translation.
- Pressing Cancel closes the reader translation popover without starting a
  translation.
- Submit still starts progress or navigates according to the API response.
- Popovers are not clipped by left rail, route pane, right rail, or phone
  bottom bar.
- No horizontal overflow appears on mobile.

## Verification Commands

Run focused suites first:

```bash
mise exec -- bun run test tests/components/popup.test.tsx tests/components/app-shell.test.ts tests/components/taxonomy-add-control.test.tsx tests/components/memory-reader-actions.test.ts
mise exec -- bun run test tests/server/translation/api-routes.test.ts tests/server/translation/runner.test.ts
mise exec -- bun run test:e2e e2e/reader.spec.ts e2e/cross-device-responsive.spec.ts
```

Then run full verification:

```bash
mise exec -- bun run typecheck
mise exec -- bun run test
mise exec -- bun run build
```

If the repository's final verification command is available and not redundant,
run it too:

```bash
mise exec -- bun run verify
```

## Handoff Checklist

- Record exact verification commands and outcomes in the PR body.
- Include browser findings for desktop and mobile popover placement.
- Mention any blocked verification with exact error text and whether it is
  unrelated local state.
- Keep commits grouped by the subtask boundaries in this workflow.
- Do not stage unrelated dirty files from other worktrees or the main
  `/Users/vvx/projekt/www/trauma` checkout.

## Acceptance Criteria

- Browser verification confirms the unified transparent popover design.
- Reader translation outside dismissal, Escape, and Cancel are verified as
  cancel actions.
- The translation submit button is visually distinct from disabled controls.
- Focused tests, typecheck, and build pass or have concrete documented blockers.
- PR handoff describes scope, verification, and any known residual risk.
