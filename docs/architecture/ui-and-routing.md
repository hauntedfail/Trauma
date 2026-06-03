# UI And Routing Architecture

TRAUMA's UI direction follows the current X-style layout while staying focused
on bookmark/memory management.

## Canonical Routes

Initial canonical routes:

- `/`
- `/memories`
- `/memories/:id`
- `/flashbacks`

`/` redirects to `/memories`.

`/memories` is the canonical browse and filter route. Query string state holds
filters and view options:

```text
/memories?q=...&category=...&tag=...&flashback=...&view=list|grid
```

`/flashbacks` is the canonical route for browsing renderable flashbacked
excerpts across memories and reader content variants.

`/category`, `/tags`, and `/memories/new` are not initial routes. Category/tag
management pages are future work.

## Shell Layout

Desktop layout:

- Left shared navigation.
- Center content area.
- Right category/tag/Flashback panel.

The left navigation is an app-shell component shared by all routes. It should
not be implemented as a page-specific component.

The right panel lists categories, tags, and Flashback shortcuts. Category and tag
items update the `/memories` query filter. Flashback shortcuts apply
`/memories?flashback=<flashback id>`. Memory navigation is handled by the
`/flashbacks` row title/link or reader anchors, not the primary right-panel
shortcut. Translated Flashback links route to `/memories/:lang_code/:id` when
the Flashback belongs to a translated variant.

## Search And Filters

`/memories?q=...` searches memory metadata and flashback metadata. The query
must match title, URL, description, category names, tag names, flashbacked text,
and stored flashback prefix/suffix context. This is not full body search; body
FTS remains future work.

`flashback=...` filters memories to a specific flashback ID. This is mainly
used by right-panel flashback shortcuts.

## Flashbacks View

`/flashbacks` is a flashback-first browse view.

Each flashback row shows the memory title, muted prefix context, flashbacked
text, and muted suffix context. The visual treatment should feel
close to a GitHub pull request file-review view: dense rows, selected text as
the focal content, muted surrounding context, subordinate source metadata, and
no full article rendering.

Clicking the row content or memory title opens the source or translated reader
route at the corresponding flashback anchor.

## Responsive Behavior

Responsive behavior is part of the initial design.

On narrow screens:

- Preserve the same conceptual shell.
- Collapse left navigation into a drawer.
- Collapse right filters into a drawer.
- Keep the add memory composer globally reachable.

## Styling System

UI styling is implemented with Tailwind CSS v4 through the SolidStart Vite
configuration.

- `src/styles/tailwind.css` owns Tailwind imports, theme tokens, and minimal
  document-level base styles.
- Page and component styling belongs on JSX through static Tailwind classes and
  Solid `classList`.
- Reader HTML produced from markdown uses Tailwind Typography plus narrow
  arbitrary variants for sanitized markup that components cannot author
  directly.
- Do not rebuild the removed `src/styles/app.css` semantic selector layer.

## Add Memory Composer

Add memory is a global composer modal or drawer. It accepts only a URL in the
initial design.

Do not create `/memories/new` for the initial implementation unless a later
design changes the route model.

## Reader

`/memories/:id` renders source `CONTENT.md` in read mode.
`/memories/:lang_code/:id` renders a current translated variant from
`memories/<memory_id>/<lang_code>/CONTENT.md` when the translation row and file
hash are current.

Psychiatrist is a reader-only surface on `/memories/:id` and
`/memories/:lang_code/:id`. It is not rendered on `/memories`, `/flashbacks`,
settings, or shell-only routes. The reader creates or resumes a memory-local
thread for the active source or translated variant, and all chat traffic goes
through TRAUMA API routes rather than browser-to-Codex connections.

The initial markdown reader supports:

- GitHub Flavored Markdown.
- Syntax flashbacking.
- HTML sanitization.
- Footnotes.
- Heading anchors.
- Table of contents that tracks the reader's live position and highlights the
  active chapter reading range (see the design-system reader-and-content TOC
  reading-progress contract).
- Controlled external embeds.
- Flashback marks.

Text selection inside reader content is a flashback toggle. Selecting
unflashbacked text creates a flashback. Selecting text that is already
flashbacked removes flashback styling from the selected text only, preserving
any unselected flashbacked text around it.

Flashbacks are local to the reader content variant where they are created.
Source Flashbacks use source reader offsets. Translated Flashbacks use
translated reader offsets and are scoped to the completed translation output
hash. Global Flashback browse and memory search surfaces include renderable
Flashbacks from both source and translated variants.

Translated reader routes show translated Flashbacks for the active translated
variant only. Source Flashbacks do not automatically appear in translated
content. Creating a Flashback from a translated route sends the active language
to the backend so the write is stored against the translated `CONTENT.md` and
current translation output hash.

External embeds auto-load in the initial design. This has privacy and network
side effects; future configuration may allow lazy or disabled embeds.
