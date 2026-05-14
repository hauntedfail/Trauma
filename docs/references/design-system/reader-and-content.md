# Reader And Content

## Reader Purpose

Reader mode is for reading extracted memory content. It is not a markdown
editor. The only direct text interaction is highlight toggling through text
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
- Title uses route-scale text.
- Source URL is visible and opens in a new tab only when safe.
- Unsafe or non-linkable source values render as text.

## Table Of Contents

The table of contents is a reader aid, not a global navigation panel. It is not
rendered inside the main reading column.

Contract:

- Registered by `MemoryReader` into the shell right rail while a ready memory
  route is mounted.
- Rendered as the first right rail island on `/memories/:id`.
- Hidden from `/memories`, `/highlights`, and other non-reader routes.
- Removed from the right rail on reader unmount.
- Rounded island surface matching right rail section geometry.
- Text is compact.
- Links target generated markdown heading anchors.
- Heading links live inside a bounded scroll body so many headings do not expand
  the right rail or the whole app layout.
- When the bounded TOC body overflows and still has content below, show a subtle
  bottom spotlight shadow inside the TOC body so the user can discover the
  scrollable content without a heavy visual block.
- Entry uses `animate-trauma-pop-bounce` for a short popup-style bounce.
- Motion is disabled under `prefers-reduced-motion: reduce`.

## Markdown Prose

Rendered markdown uses Tailwind Typography through `@tailwindcss/typography`.

Reader prose rules:

- `prose max-w-none min-w-0`.
- Headings use `text-trauma-text-primary`.
- Body text uses `text-trauma-text-secondary`.
- Links use `text-trauma-accent` and underline offset.
- Inline code uses the mono font and elevated token background.
- Code blocks use `bg-trauma-bg-sunken` and border tokens.
- Tables use full width and tokenised borders.
- Images must stay within content width.
- Embeds use responsive aspect-video bounds.

Do not introduce broad global prose selectors outside the reader unless the
markup cannot be authored directly.

## Highlight Rendering

Persisted highlights render as:

```html
<mark data-highlight-id="...">
```

Visual contract:

- Rounded inline mark.
- `bg-trauma-highlight-bg`.
- `text-trauma-highlight-ink`.
- Small horizontal padding.

Highlight excerpts use `HighlightExcerpt`, not the reader prose mark style.

## Highlight Interaction

Selecting reader text toggles highlight state:

- Selecting unmarked text highlights it.
- Selecting a fully marked range unhighlights it.
- The UI applies the optimistic mark immediately.
- The server persists the highlight state asynchronously.
- On failure, the reader restores previous HTML and shows "Highlight failed".

The reader must keep this interaction independent from general content editing.

## Reader State Handling

`MemoryReader` uses keyed ready rendering so route changes remount reader
content and do not reuse stale DOM.

Reader fallback states use the same route frame and should not look like a
separate page type.
