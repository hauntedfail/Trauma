# Task 17.3: Shell, Navigation, And Theme Controls

## Goal

Rebuild the app shell from the sample's X-style left rail while preserving
TRAUMA's existing Solid route ownership, global add-memory popover, right-side
filter panel, and backup failsafe banner.

## Ownership

Primary files:

- `src/components/shell/AppShell.tsx`
- `src/components/shell/theme.ts`
- `src/components/brand/TraumaMark.tsx`
- `src/components/icons/TraumaIcons.tsx`
- `tests/components/app-shell.test.ts`
- `e2e/browse-shell.spec.ts`

## Source Mapping

- Sample `Sidebar` maps to `NavigationContent` and shell layout.
- Sample `ThemeBlock` maps to a Solid theme control inside the rail.
- Sample rail `Add memory` button maps to the existing
  shell add-memory composer popover.
- Sample `profile` maps to a local archive status surface. It must not imply
  auth or account management.
- Sample `Tweaks` and `tweaks-panel.jsx` are out of scope.

## Decisions To Preserve

- Current routes stay owned by SolidStart:
  - `/memories`
  - `/highlights`
  - `/memories/:id`
- Do not add live links to missing `/category`, `/tags`, `/backup`, or
  `/settings` routes in this workflow.
- The right-side filter panel remains route-global and uses current query
  helpers.
- The backup failsafe banner remains visible above route content.
- Theme changes are UI-only and local to the browser. They must not write to
  SQLite or `trauma.config.json`.

## Execution Steps

1. Add `src/components/shell/theme.ts`.

   Required exports:

   ```ts
    export type BrightnessMode = "sun" | "night";
    export type SurfaceMode = "normal" | "paper";
    export type ThemeName = "light" | "midnight" | "paper" | "hermes";
    export type TraumaTheme =
      | "warm-light"
      | "black-dark"
      | "paper-warm-light"
      | "paper-black-dark";

    export function themeNameFromPreference(input: {
      brightness: BrightnessMode;
      surface: SurfaceMode;
    }): ThemeName;

    export function themeFromPreference(input: {
      brightness: BrightnessMode;
      surface: SurfaceMode;
    }): TraumaTheme;
    ```

    Mapping:

    Theme names:

    - `sun` + `normal` -> `light`
    - `night` + `normal` -> `midnight`
    - `sun` + `paper` -> `paper`
    - `night` + `paper` -> `hermes`

    Theme tokens (`data-theme`):

    - `sun` + `normal` -> `warm-light`
    - `night` + `normal` -> `black-dark`
    - `sun` + `paper` -> `paper-warm-light`
    - `night` + `paper` -> `paper-black-dark`

   Surface labels are presentation-only:

   - `normal` is labelled Light when brightness is `sun`
   - `normal` is labelled Midnight when brightness is `night`
   - `paper` is labelled Paper when brightness is `sun`
   - `paper` is labelled Hermès when brightness is `night`

2. In `AppShell`, initialize theme controls with Solid state.

   Use `onMount` for browser-only reads and writes:

   - read local storage keys `trauma:brightness` and `trauma:surface`
   - apply `data-theme` to `document.documentElement`
   - write updates back to local storage after user interaction

   Do not read `document` or `localStorage` during SSR.

3. Replace text-only brand and nav with the refined rail structure.

   Required accessible labels:

   - brand link: `TRAUMA home`
   - Memories link: `Memories`
   - Highlights link: `Highlights`
   - theme group: `Theme`
   - add memory button: `Add memory`

4. Keep mobile and tablet reachability.

   Required breakpoints:

   - desktop: left rail, main pane, right filter panel visible
   - tablet: compact left rail, main pane, filter drawer button
   - mobile: top bar controls, drawers for nav and filters

5. Convert fixed colors in shell component classes to token utilities.

   Use utilities such as:

   - `bg-trauma-bg-base`
   - `bg-trauma-bg-surface`
   - `bg-trauma-bg-tint`
   - `text-trauma-text-primary`
   - `text-trauma-text-muted`
   - `border-trauma-border`
   - `bg-trauma-accent`
   - `text-trauma-accent-ink`

6. Add or update tests.

   Unit-level:

   ```bash
   mise exec -- bun run test tests/components/app-shell.test.ts
   ```

   E2E:

   ```bash
   mise exec -- bun run test:e2e -- e2e/browse-shell.spec.ts
   ```

## Acceptance Criteria

- The shell visually follows the sample rail without collapsing route/data
  responsibilities into one file.
- Theme controls change `data-theme` and persist local browser preference.
- Add-memory remains reachable from shell routes.
- No dead links route users to the catch-all page.
