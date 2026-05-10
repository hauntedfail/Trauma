# Task 16a: Tailwind Migration Workflow

## Goal

Move Trauma's component styling from `src/styles/app.css` to Tailwind CSS.
`app.css` must stop being the place where UI behavior is encoded; styling should
live on the component markup as readable Tailwind classes.

## Decision

Tailwind is compatible with this stack because SolidStart exposes Vite config
through `app.config.ts`, and Tailwind v4 provides a Vite plugin. Use Tailwind v4
with `@tailwindcss/vite`. Add `@tailwindcss/typography` only for rendered
markdown because reader HTML arrives through `innerHTML`.

## Scope

Modify:

- `package.json`
- `bun.lock`
- `app.config.ts`
- `src/app.tsx`
- `src/styles/app.css`
- `src/styles/tailwind.css`
- `src/components/shell/AppShell.tsx`
- `src/components/memories/MemoryBrowse.tsx`
- `src/components/reader/MemoryReader.tsx`
- `src/routes/highlights/index.tsx`
- `src/routes/[...404].tsx`
- `docs/references/technology-stack.md`

Out of scope:

- Component redesign.
- Route behavior changes.
- New UI state.
- Server, database, importer, backup, or reader parsing changes.

## Migration Rules

- Do not recreate `app.css` as a pile of Tailwind `@apply` selectors.
- Prefer component-local `class` strings and Solid `classList` with full static
  class names.
- Keep dynamic values out of generated class names. Use literal alternatives:
  `classList={{ "bg-trauma-surface": active(), "bg-transparent": !active() }}`.
- Use Tailwind theme tokens for Trauma colors instead of raw repeated hex values.
- Limit arbitrary selectors to rendered markdown HTML, where the element markup
  cannot be edited directly.
- Delete `src/styles/app.css` when migration is complete. If a CSS entry file is
  needed, use `src/styles/tailwind.css`.

## Implementation Plan

### Phase 1: Install and wire Tailwind

- Install:

```bash
bun add -d tailwindcss @tailwindcss/vite @tailwindcss/typography
```

- Add `tailwindcss()` to every SolidStart Vite router returned from
  `app.config.ts`.
- Create `src/styles/tailwind.css`:

```css
@import "tailwindcss";
@plugin "@tailwindcss/typography";

@theme {
  --color-trauma-bg-base: #f6f7f4;
  --color-trauma-bg-surface: #fffefa;
  --color-trauma-border: #d8ded5;
  --color-trauma-text-primary: #111827;
  --color-trauma-text-muted: #667064;
  --color-trauma-accent: #111827;
}
```

- Update `src/app.tsx` to import `./styles/tailwind.css`.

### Phase 2: Move layout styles into shell components

Apply the old shell classes directly in `AppShell.tsx`:

- `app-shell`: page grid, min height, base background, text color.
- `left-nav` and `right-panel`: sticky side panels, borders, padding, scroll.
- `mobile-topbar`: fixed mobile header, navigation/filter icon buttons.
- `drawer-backdrop`, `drawer-panel`, `drawer-close`: mobile drawer surface.
- `navigation-content`, `brand`, `nav-links`, `add-memory`: left navigation.
- `filter-panel`, `filter-section`, `filter-list`, `highlight-shortcuts`: right
  filter controls.
- `global-composer`: add-memory form surface.

Keep responsive breakpoints in Tailwind classes on the same elements instead of
centralizing them in media queries.

### Phase 3: Move browse and highlight list styles

Apply the old timeline and card styles in `MemoryBrowse.tsx` and
`routes/highlights/index.tsx`:

- `timeline`: constrained main column spacing.
- `timeline-header`: compact page heading layout.
- `eyebrow`: small uppercase label.
- `view-toggle`: segmented list/grid control.
- `composer-baseline`: inline add-memory URL input.
- `search-row`: search field layout.
- `memory-list` and `memory-grid`: list/grid result containers.
- `memory-item`: card surface, spacing, title, URL, metadata chips.
- `memory-item[data-view="grid"]`: grid-specific height and layout rules.
- `empty-state`: empty and error states.

The visual result should remain close to the existing app, but the source of
truth becomes component markup.

### Phase 4: Move reader styles

Apply reader page styling in `MemoryReader.tsx`:

- `reader-page`: main reader spacing and width.
- `reader-header`: title, source URL, and reader label.
- `reader-layout`: content and table-of-contents grid.
- `reader-toc`: sticky table of contents.
- `reader-state`: loading/not-found/error states.

For `reader-content`, use Tailwind Typography:

```tsx
<div
  class="prose max-w-none prose-a:text-trauma-text-primary prose-mark:bg-yellow-100"
  innerHTML={props.result.rendered.html}
/>
```

Use narrow arbitrary variants only for markdown details that Typography does not
cover, such as persisted highlight marks, tables, embedded media, and code
blocks.

### Phase 5: Remove the old stylesheet

- Delete `src/styles/app.css`.
- Search for all old semantic style classes and remove or replace them:

```bash
rg -n "app-shell|left-nav|right-panel|timeline|memory-item|reader-content|filter-panel|drawer-" src
```

- Keep semantic class names only when tests or accessibility hooks require them.
  Do not keep them solely for styling.

### Phase 6: Verify

Run:

```bash
mise exec -- bun run verify
mise exec -- bun run test:e2e
mise exec -- bun run dev:smoke
```

Manual visual check:

- `/memories` on desktop, tablet, and mobile.
- `/highlights` on desktop and mobile.
- `/memories/:id` reader view with headings, code, tables, links, images, and
  highlight marks.
- Drawer navigation and filters on narrow viewport.

## Acceptance Criteria

- `src/styles/app.css` is removed.
- `src/styles/tailwind.css` is the only global CSS entry.
- Existing app layout and reader readability are preserved.
- No route or server behavior changes are included.
- `bun run verify`, `bun run test:e2e`, and `bun run dev:smoke` pass.
- PR description includes before/after screenshots for `/memories`,
  `/highlights`, and `/memories/:id`.

## Branching

Start from the current `triage` branch while PR #10 is open:

```bash
git switch triage
git pull --ff-only origin triage
git switch -c triage/tailwind-migration
```

Open the PR against `triage` while triage remains active. If `triage` is merged
first, rebase this branch onto `main` and retarget the PR.
