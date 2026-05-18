# Task 18-alpha: UI component and routing refresh

## Status

- State: Ready for implementation planning handoff
- Base branch: `workflow18-read-status`
- Implementation branch: `refine/ui-routing-refresh`
- Execution model: implement in the subtask order below. Independent subtasks
  may be delegated to separate workers only when their owned files do not
  overlap.
- Out of scope: database schema changes, importer/extractor changes, backup
  semantics, reader markdown rendering changes, broad route redesign, and any
  route that is not explicitly named in a subtask.

## Planning boundary

This document and its subtask files may be edited during planning. Source code,
tests, and design-system docs must not be changed from a planning prompt unless
the user explicitly moves the branch into implementation. If a planning
conversation surfaces a concrete fix, record the requirement in the owning
subtask first. Only keep an implementation diff from the planning phase when the
user explicitly says to keep that already-applied fix; otherwise revert it and
leave only the workflow-plan update.

## Core intent

Task 18-alpha refreshes shared UI foundations that became fragmented during
Task 18:

- one shared taxonomy rendering primitive for memory-row chips and right-rail
  category/tag filter rows
- one shared popup shell for Add memory, Theme, and general action menus
- a unified menu-popup path for memory and Moment action menus
- composer and Theme popovers using the same popup shell and background surface
  contract as the action menus
- route-surface alignment so the refreshed components behave consistently on
  `/memories`, `/memories/:id`, `/flashbacks`, `/moments`, and existing shell
  navigation surfaces

This is primarily a UI architecture cleanup. It must preserve the current
desktop design, mobile/tab behaviour, product language, and Task 18 memory
actions.

## Global invariants

- Do not change SQLite schema or migration files.
- Do not change memory deletion, backup, import, Flashback, or Moment
  persistence semantics.
- Use current product language: `Flashback` is a text marker and `Moment` is a
  section bookmark.
- Keep `ThemeBlock`'s segmented toggle buttons as the special-case selector UI.
  The popup shell around Theme may be shared; the theme selector itself remains
  domain-specific.
- Add memory, Theme, memory action menus, and Moment action menus share the same
  popup outside-click, Escape, z-index, animation, and background-surface
  contract.
- Popup content remains pluggable. The shared shell owns chrome and interaction;
  menu, composer, and Theme content own their internal form/menu layout.
- The common popup background should follow the current action-menu visual
  direction: semantic app background/elevated surface tokens, current theme
  texture continuity, `rounded-[20px]`, border token, and bounded shadow.
- Do not use global CSS selectors where a focused Solid component contract can
  express the behaviour.
- Existing tests that inspect source strings should either be replaced with
  behavioural tests or updated to assert the new component boundaries.
- Update design-system docs only for durable component contracts, not for
  implementation diary details.

## Subtask execution order

1. [18-alpha.1 Taxonomy rendering consolidation](task-18-alpha-ui-routing-refresh/01-taxonomy-rendering-consolidation.md)
2. [18-alpha.2 Shared popup shell foundation](task-18-alpha-ui-routing-refresh/02-shared-popup-shell-foundation.md)
3. [18-alpha.3 General action menu migration](task-18-alpha-ui-routing-refresh/03-general-action-menu-migration.md)
4. [18-alpha.4 Composer and Theme popup migration](task-18-alpha-ui-routing-refresh/04-composer-theme-popup-migration.md)
5. [18-alpha.5 Route surface alignment](task-18-alpha-ui-routing-refresh/05-route-surface-alignment.md)
6. [18-alpha.6 Integration verification and design docs](task-18-alpha-ui-routing-refresh/06-integration-verification-and-design-docs.md)

## Dependency and parallelisation guidance

- `18-alpha.1` can run in parallel with `18-alpha.2`; taxonomy rendering and
  popup shell foundation do not need to touch the same files except tests.
- `18-alpha.3` depends on `18-alpha.2`.
- `18-alpha.4` depends on `18-alpha.2` and should wait until popup shell API is
  stable.
- `18-alpha.5` depends on `18-alpha.1`, `18-alpha.3`, and `18-alpha.4`, because
  route surfaces should only be aligned after shared components exist.
- `18-alpha.6` is the final integration gate and must run after all prior
  subtasks.

When using subagents, assign disjoint ownership:

- Worker A may own `18-alpha.1` taxonomy components and tests.
- Worker B may own `18-alpha.2` popup shell component and tests.
- The main rollout should integrate `18-alpha.3` and `18-alpha.4` after Worker B
  lands, because these touch shared shell and menu consumers.

## Verification baseline

Every implementation slice must run its targeted tests and `mise exec -- bun run
typecheck`. The final integration slice must run:

```sh
git diff --check
mise exec -- bun run verify
mise exec -- bun run test:e2e
```

If local browser verification is used for screenshots, check at least:

- `/memories`
- `/memories/:id` with right rail and reader menus
- `/flashbacks`
- `/moments`
- phone-width bottom tabs with Add memory and Theme popovers
