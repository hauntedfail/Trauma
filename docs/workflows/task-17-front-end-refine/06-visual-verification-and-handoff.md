# Task 17.6: Visual Verification And Handoff

## Goal

Verify that the refined UI works across the real app routes and viewports before
handoff.

## Ownership

Primary files:

- `e2e/browse-shell.spec.ts`
- `e2e/reader.spec.ts`
- `tests/scripts/tailwind-migration.test.ts`
- PR description and review evidence

Conditional files:

- `docs/quality/verification.md` if a new required visual-check command is
  introduced.

## Required Viewports

Check all of these:

- desktop: `1440x1000`
- tablet: `900x900`
- mobile: `390x844`

## Required Routes

Check all of these:

- `/memories`
- `/memories?view=grid`
- `/memories?q=reader`
- `/highlights`
- `/memories/memory-foundation` in fixture mode

## Execution Steps

1. Run static and focused tests:

   ```bash
   mise exec -- bun run typecheck
   mise exec -- bun run test tests/scripts/tailwind-migration.test.ts
   mise exec -- bun run test tests/components/brand-assets.test.ts tests/components/trauma-icons.test.ts tests/components/app-shell.test.ts
   mise exec -- bun run test tests/memories/browse-data.test.ts tests/components/highlights-route-state.test.ts
   mise exec -- bun run test tests/components/reader-highlight-events.test.ts tests/components/reader-highlight-failsafe.test.ts
   ```

2. Run route E2E:

   ```bash
   mise exec -- bun run test:e2e -- e2e/browse-shell.spec.ts e2e/reader.spec.ts
   ```

3. Run full verification:

   ```bash
   mise exec -- bun run verify
   mise exec -- bun run test:e2e
   ```

4. Use the browser or Playwright screenshots to inspect the required viewports.

   Minimum visual checks:

   - TRAUMA mark is visible in the rail.
   - Active nav item uses the filled icon variant.
   - Search pill, memory rows, and highlight quotes match the sample direction.
   - Theme controls fit inside the rail without text overflow.
   - No button text overflows on mobile.
   - Reader content and table of contents do not overlap.
   - Backup failsafe banner still appears above route content when active.

5. Compare against sample screenshots:

   ```bash
   find refined_sample/screenshots -maxdepth 1 -type f -print
   ```

   Use the screenshots as visual direction, not as pixel-perfect golden files.

## Acceptance Criteria

- All required commands pass, or any remaining browser-runner limitation is
  documented with exact error output.
- Desktop, tablet, and mobile layouts are non-overlapping and usable.
- The refined UI does not remove existing browse, highlight, reader, add-memory,
  or backup failsafe behaviours.
- PR handoff includes screenshots or a clear textual visual QA record.
