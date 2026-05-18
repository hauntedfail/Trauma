# 18-alpha.6 Integration verification and design docs

## Goal

Run the final integration gate, remove stale design-system wording, and record
the durable component contracts that emerged from implementation.

## Files likely owned

- Modify: `docs/references/design-system/components-and-surfaces.md`
- Modify: `docs/references/design-system/interaction-and-accessibility.md`
- Modify: `docs/references/design-system/layout-and-shell.md` only if layer or
  shell overflow rules changed.
- Modify: `docs/workflows/task-18-alpha-ui-routing-refresh.md` only if the
  completed implementation changes the execution record.

## Documentation rules

- Document semantic component rules, not PR history.
- Keep `AGENTS.md` unchanged unless a new navigation pointer is required.
- Do not duplicate exact class strings unless the class is part of a durable
  public component contract.
- Remove stale wording that says Theme/Add memory/action menus use separate
  popup implementations after the shared popup shell lands.
- Keep route behaviour docs aligned with the actual route list.

## Verification commands

Run all commands from the repository root:

```sh
git diff --check
mise exec -- bun --bun x vitest run tests/components/popup.test.tsx tests/components/taxonomy-list.test.tsx
mise exec -- bun --bun x vitest run tests/components/app-shell.test.ts tests/components/mobile-responsive-contract.test.ts
mise exec -- bun --bun x vitest run tests/components/memory-action-menu.test.tsx tests/components/moment-action-menu.test.tsx
mise exec -- bun run verify
mise exec -- bun run test:e2e
```

If local Playwright cannot run because of browser or macOS sandbox limits,
record the exact failure and run the highest available local verification
instead. Do not claim E2E coverage passed unless the command exits 0.

## Visual checks

When a local dev server is available, inspect:

- `/memories`: memory-row taxonomy chips and right-rail filters
- `/memories/:id`: reader action menu, Theme popup from shell, Add memory popup
- `/flashbacks`: shell and popup layering
- `/moments`: Moment action menu
- phone width: bottom tab Add memory and Theme popovers

## Acceptance criteria

- Final `bun run verify` passes.
- E2E either passes or a concrete environment limitation is recorded.
- Design-system docs describe the shared popup shell and taxonomy rendering
  contract.
- Workflow docs contain no stale one-off review diary.

