# Reader And Content

## Reader Purpose

Reader mode is for reading extracted memory content. It is not a markdown
editor. The only direct text interaction is flashback toggling through text
selection.

## Reader Frame

Reader route frames use:

```text
min-h-screen w-full bg-trauma-bg-surface
```

The frame must fill the main pane. It must not centre itself independently
inside the shell.

## Reader Header

The reader header is sticky and route-local.

Contract:

- Back control links to `/memories`.
- Header uses the route frame background with backdrop blur.
- Header label is exactly `Memory`.
- Do not repeat the memory title in the header; the markdown body already owns
  the visible content title.
- Do not render `Reader mode` copy.
- Source URL is visible and opens in a new tab only when safe.
- Source URL links use `text-trauma-link` and `hover:text-trauma-link-hover`.
- Unsafe or non-linkable source values render as text.

## Table Of Contents

The table of contents is a reader aid, not a global navigation panel. It is not
rendered inside the main reading column.

Contract:

- Registered by `MemoryReader` into the shell right rail while a ready memory
  route is mounted.
- Rendered as the first right rail island on `/memories/:id`.
- Hidden from `/memories`, `/flashbacks`, and other non-reader routes.
- Removed from the right rail on reader unmount.
- Rounded island surface matching right rail section geometry.
- Text is compact.
- Links target generated markdown heading anchors and use the reader link
  token on hover.
- Heading entries are left-aligned inside the island. Do not add global list
  padding; reserve only the small Moment affordance slot and use heading-level
  indentation for hierarchy.
- Heading links live inside a bounded scroll body so many headings do not expand
  the right rail or the whole app layout.
- When the bounded TOC body can scroll further, show a subtle blur fade only on
  the available scroll edge. At the top of the list this appears only after the
  user has scrolled down; at the bottom it disappears when no more content
  remains below. The fade starts at the scroll body edge and uses CSS mask
  gradients so the transition into unblurred content is soft.
- Entry uses `animate-trauma-pop-bounce` for a short popup-style bounce.
- Motion is disabled under `prefers-reduced-motion: reduce`.

## Markdown Prose

Rendered markdown uses Tailwind Typography through `@tailwindcss/typography`.

Reader prose rules:

- `prose max-w-none min-w-0`.
- Headings use `text-trauma-text-primary`.
- Body text uses `text-trauma-text-secondary`.
- Links use `text-trauma-link` and underline offset.
- Inline code uses the mono font and elevated token background.
- Code blocks use `bg-trauma-bg-sunken` and border tokens.
- Tables use full width and tokenised borders.
- Images must stay within content width.
- Embeds use responsive aspect-video bounds.

Do not introduce broad global prose selectors outside the reader unless the
markup cannot be authored directly.

## Flashback Rendering

Persisted flashbacks render as:

```html
<mark data-flashback-id="...">
```

Visual contract:

- Rounded inline mark.
- `bg-trauma-flashback-bg`.
- `text-trauma-flashback-ink`.
- Small horizontal padding.
- When a persisted flashback is the URL hash target, the reader scopes the
  target treatment to `.trauma-reader-content mark[data-flashback-id]:target`
  and uses anchor flashback tokens so every theme keeps the linked quote legible.
  Keep this target treatment in the reader scope rather than as a generic mark
  rule.

Flashback browse excerpts and right-rail shortcuts use the shared
`FlashbackInlineText` primitive, not the reader prose mark style.

## Flashback Interaction

Selecting reader text toggles flashback state:

- Selecting unmarked text flashbacks it.
- Selecting a fully marked range unflashbacks it.
- The UI applies the optimistic mark immediately.
- The server persists the flashback state asynchronously.
- On failure, the reader restores previous HTML and shows "Flashback failed".

The reader must keep this interaction independent from general content editing.

## Reader State Handling

`MemoryReader` uses keyed ready rendering so route changes remount reader
content and do not reuse stale DOM.

Reader fallback states use the same route frame and should not look like a
separate page type.
