# TRAUMA Design System

## Purpose

TRAUMA is a local-first memory manager for saved web content. The UI should
feel direct, dense, and app-like. It should support repeated reading,
filtering, and recall rather than marketing presentation.

The visual reference is the current X/Twitter shell model: persistent left
navigation, central content stream, and an optional right-side context rail.
TRAUMA adapts that model for local archive work.

## Product Tone

- Quiet and utilitarian.
- High contrast, especially in night mode.
- Dense enough for scanning lists, but with enough spacing for long reading.
- Strong route ownership: shell chrome stays global, route surfaces own their
  content.
- No landing-page hero treatment inside the app.
- No decorative background shapes, gradient ornaments, or atmospheric panels.

## Design Principles

1. Use one semantic background per theme for the page, left rail, and route
   panes. The app should not show accidental gutters between shell columns.
2. Use elevation only for controls, selected state, compact panels, and true
   islands. Do not use elevation to frame every route section.
3. Keep navigation persistent and predictable. Do not add live links to routes
   that are not implemented.
4. Treat the right rail differently from the left rail. The right rail is a
   base-colour column containing independent rounded islands.
5. Make rows and excerpts clickable where users expect direct navigation. Avoid
   extra "Open" buttons when the full row can own the link.
6. Keep typography stable. No viewport-scaled font sizes and no negative letter
   spacing.
7. Prefer semantic Tailwind tokens over raw colours in components.
8. Preserve existing data, import, flashback, and backup behaviour when
   refining UI.

## Current Design Scope

The design system currently covers:

- App shell.
- Left navigation rail.
- Theme controls.
- Right context/filter rail.
- Tablet icon rail and phone bottom tabs.
- Memory browse list and grid.
- Flashback browse page.
- Reader mode.
- Add-memory composer.
- Backup failsafe banner surface.
- TRAUMA brand mark and custom icons.

It does not define authentication screens, team/user management, billing,
settings routes, or public marketing pages.

## Source Of Truth

Design tokens live in `src/styles/tailwind.css`.

Theme selection logic lives in `src/components/shell/theme.ts`.

Shell structure and shared rail components live in
`src/components/shell/AppShell.tsx`.

Route surfaces own route-specific composition:

- `src/components/memories/MemoryBrowse.tsx`
- `src/routes/flashbacks/index.tsx`
- `src/components/reader/MemoryReader.tsx`
- `src/components/reader/reader-styles.ts`

The design system reference documents describe the intended contract. The code
and tests are the executable source of truth.

## Non-Goals

- Do not create a separate design-token build pipeline.
- Do not add a component storybook until there is a real maintenance need.
- Do not bring back `src/styles/app.css`.
- Do not port external prototype component structure directly into the app.
- Do not turn `AGENTS.md` into design documentation.
