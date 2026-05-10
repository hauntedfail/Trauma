# UI And Routing Architecture

Trauma's UI direction follows the current X-style layout while staying focused
on bookmark/memory management.

## Canonical Routes

Initial canonical routes:

- `/`
- `/memories`
- `/memories/:id`
- `/highlights`

`/` redirects to `/memories`.

`/memories` is the canonical browse and filter route. Query string state holds
filters and view options:

```text
/memories?q=...&category=...&tag=...&highlight=...&view=list|grid
```

`/highlights` is the canonical route for browsing highlighted excerpts across
memories.

`/category`, `/tags`, and `/memories/new` are not initial routes. Category/tag
management pages are future work.

## Shell Layout

Desktop layout:

- Left shared navigation.
- Center content area.
- Right category/tag/highlight panel.

The left navigation is an app-shell component shared by all routes. It should
not be implemented as a page-specific component.

The right panel lists categories, tags, and recent highlights. Category and tag
items update the `/memories` query filter. Highlight shortcuts apply
`/memories?highlight=<highlight id>`. Source-memory navigation is handled by
the `/highlights` row title/link or reader anchors, not the primary right-panel
shortcut.

## Search And Filters

`/memories?q=...` searches memory metadata and highlight metadata. The query
must match title, URL, description, category names, tag names, highlighted text,
and stored highlight prefix/suffix context. This is not full body search; body
FTS remains future work.

`highlight=...` filters memories to a specific highlight ID. This is mainly
used by right-panel highlight shortcuts.

## Highlights View

`/highlights` is a highlight-first browse view.

Each highlight row shows the source memory title, muted prefix context,
highlighted text, and muted suffix context. The visual treatment should feel
close to a GitHub pull request file-review view: dense rows, quote-focused
content, clear source labels, and no full article rendering.

Clicking the source title or quote opens `/memories/:id` at the corresponding
highlight anchor.

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

`/memories/:id` renders `CONTENT.md` in read mode.

The initial markdown reader supports:

- GitHub Flavored Markdown.
- Syntax highlighting.
- HTML sanitization.
- Footnotes.
- Heading anchors.
- Table of contents.
- Controlled external embeds.
- Highlight marks.

Text selection inside reader content is a highlight toggle. Selecting
unhighlighted text creates a highlight. Selecting text that is already
highlighted removes highlight styling from the selected text only, preserving
any unselected highlighted text around it.

External embeds auto-load in the initial design. This has privacy and network
side effects; future configuration may allow lazy or disabled embeds.
