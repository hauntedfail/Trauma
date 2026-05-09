# UI And Routing Architecture

Trauma's UI direction follows the current X-style layout while staying focused
on bookmark/memory management.

## Canonical Routes

Initial canonical routes:

- `/`
- `/memories`
- `/memories/:id`

`/` redirects to `/memories`.

`/memories` is the canonical browse and filter route. Query string state holds
filters and view options:

```text
/memories?q=...&category=...&tag=...&view=list|grid
```

`/category`, `/tags`, and `/memories/new` are not initial routes. Category/tag
management pages are future work.

## Shell Layout

Desktop layout:

- Left shared navigation.
- Center content area.
- Right category/tag filter panel.

The left navigation is an app-shell component shared by all routes. It should
not be implemented as a page-specific component.

The right panel lists categories and tags. Clicking an item updates the
`/memories` query filter.

## Responsive Behavior

Responsive behavior is part of the initial design.

On narrow screens:

- Preserve the same conceptual shell.
- Collapse left navigation into a drawer.
- Collapse right filters into a drawer.
- Keep the add memory composer globally reachable.

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
