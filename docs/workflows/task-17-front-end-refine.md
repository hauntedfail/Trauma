# Task 17: Front-End Refine From Sample Workflow

## Goal

Recreate the user-provided refined sample as the real SolidStart/Tailwind
front-end while preserving TRAUMA's current route, data, import, highlight, and
backup behaviour.

## Current Status

Ready for implementation. This workflow should run on a `refine/*` branch.

## Source Sample

Use the local `refined_sample/` directory as the visual and interaction source.
If the directory is missing in an implementation workspace, stop and request the
sample instead of guessing the design.

Relevant sample files:

- `refined_sample/app.jsx`: React prototype for shell, rail, memory index,
  memory detail, row layout, search, and theme controls.
- `refined_sample/styles.css`: component and layout styling to translate into
  Tailwind classes and reusable class constants.
- `refined_sample/colors_and_type.css`: brand colors, theme variables,
  typography, spacing, radius, and semantic type tokens.
- `refined_sample/icons.jsx`: custom TRAUMA icon set.
- `refined_sample/assets/trauma-mark.svg` and
  `refined_sample/assets/trauma-mark.png`: brand mark for component logo and
  favicon generation.
- `refined_sample/screenshots/*.png`: visual reference snapshots.

Ignore `refined_sample/tweaks-panel.jsx`; it belongs to the standalone sample
host and is not part of the app refine.

## Architecture

Keep the existing Solid route/data boundaries. The sample's single `app.jsx`
must be decomposed into the current TRAUMA component structure instead of being
ported as one large component. Styling stays in Tailwind: `src/styles/app.css`
must not return.

## Required Context

- [Technology stack](../references/technology-stack.md)
- [UI and routing architecture](../architecture/ui-and-routing.md)
- [Coding standards](../references/coding-standards/INDEX.md)
- [Tailwind migration archive](archive/task-16a-tailwind-migration.md)

## Parent Exec Plan

Execute these domain plans in order:

1. [Design system tokens and theme contract](task-17-front-end-refine/01-design-system-tokens.md)
2. [Brand assets and icon system](task-17-front-end-refine/02-brand-assets-and-icons.md)
3. [Shell, navigation, and theme controls](task-17-front-end-refine/03-shell-navigation-and-theme.md)
4. [Memory browse and highlight surfaces](task-17-front-end-refine/04-memory-browse-and-highlight-surfaces.md)
5. [Reader surface](task-17-front-end-refine/05-reader-surface.md)
6. [UI review correction: shell spacing, right rail, and row interaction](task-17-front-end-refine/07-shell-spacing-right-rail-row-interaction.md)
7. [Visual verification and handoff](task-17-front-end-refine/06-visual-verification-and-handoff.md)

## Cross-Domain Rules

- Do not change server persistence, importer, backup, DB schema, or browser
  extension behaviour for this workflow.
- Do not import React patterns from the sample. Implement with Solid primitives
  and existing SolidStart route/data APIs.
- Do not reintroduce `src/styles/app.css` or broad semantic CSS selector
  styling.
- Do not port negative letter spacing from the sample. Project UI text uses
  `letter-spacing: 0`.
- Do not add dead navigation links to routes that do not exist. If a sample nav
  item has no route, render it only as an explicit disabled/future control or
  leave it out for this pass.
- Keep `Add memory` wired to the existing `AddMemoryForm` and `POST
  /api/memories` path.
- Keep highlight selection/toggle behaviour unchanged.

## Shared Verification

Every implementation PR in this workflow should run:

```bash
mise exec -- bun run typecheck
mise exec -- bun run test
mise exec -- bun run build
```

Run browser verification after the route surfaces are changed:

```bash
mise exec -- bun run test:e2e
```

For a full final pass:

```bash
mise exec -- bun run verify
mise exec -- bun run test:e2e
```

## PR Handoff

The PR body must include:

- Domain plans implemented.
- Source sample files used.
- Routes visually checked.
- Desktop and mobile viewport evidence.
- Exact verification commands and outcomes.
