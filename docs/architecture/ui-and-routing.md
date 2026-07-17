# UI And Routing Architecture

This document owns the canonical route and responsive-shell contract. The
[design system](../references/design-system/INDEX.md) owns visual and
accessibility details without redefining route availability.

## Canonical Routes

- `/memories`: browse, search, filter, read state, and memory actions.
- `/memories/:id`: source reader.
- `/memories/:langCode/:id`: current translated reader.
- `/flashbacks`: renderable source and translated Flashback excerpts.
- `/moments`: source-canonical section bookmarks.
- `/settings`: translation defaults, Codex model/effort, and Codex auth state.

`/` redirects to `/memories`. `/highlights` redirects to `/flashbacks` and
`/flashback` redirects to `/moments` only for legacy compatibility; do not link
to them or use their retired terminology in new contracts.

`/category`, `/tags`, `/backup`, and `/memories/new` are not routes. Categories
and tags are managed inline and through the browse right rail. Backup is exposed
through status/failsafe surfaces. Add memory is a global shell popover.

## Browse Query State

`/memories` owns filter and view state in the URL:

```text
/memories?q=...&category=...&tag=...&flashback=...&view=list|grid
```

`q` supports free text, `title:`, `url:`, `tag:`, `category:`, `flashback:`, and
standalone `read`/`unread` terms. Search covers memory metadata, taxonomy, and
renderable Flashback text/context, not the full reader body. Explicit taxonomy
and Flashback query keys combine with search terms rather than clearing them.

Memory results are cursor-paginated. Read-state tabs manipulate the search
terms, and list/grid remains URL-addressable even when no dedicated view toggle
is rendered.

`/flashbacks` and `/moments` use an opaque `cursor` query value. The URL is the
page source of truth: Next writes the continuation cursor, First removes it,
and browser Back or Reload restores that exact page. These routes render only
the current page; they never append earlier pages to the DOM.

## Shell Layout

Desktop (`min-width: 1041px`):

- Persistent `275px` left rail.
- Route-owned main pane up to `840px`.
- `360px` right rail with category/tag filters and contextual shortcuts.
- Ready source and translated readers may replace the top right-rail slot with
  their table of contents.

Tablet (`721px` through `1040px`):

- Compact `80px` icon rail and route main pane.
- No right rail, navigation drawer, filter drawer, or duplicate brand/filter
  header.
- Add memory and Theme remain available from rail popovers.

Phone (`max-width: 720px`):

- Compact brand header, route main pane, and fixed horizontally scrollable
  bottom `Primary tabs` bar.
- Live tabs: Memories, Flashbacks, Moments, and Settings.
- Disabled placeholders: Categories, Tags, and Backup.
- Add memory and Theme are actions that open popovers above the bar.
- No navigation or filter drawer.

The shell owns global chrome, composer/theme popup state, backup alert, and the
right-rail slot. Routes own headers, controls, loading/empty/error states, and
content. Responsive route/component sizing should use the shared fluid and
container-query utilities rather than device-specific wrappers.

## Flashbacks View

`/flashbacks` renders dense excerpt rows. Each row shows muted prefix/suffix
context, selected text as the focal content, and the memory title as subordinate
metadata. Its link opens the matching source or translated reader at the
Flashback anchor.

Right-rail Flashback shortcuts may filter `/memories` with `flashback=<id>`.
They do not replace direct reader links from the canonical Flashbacks route.
The route uses a bounded server page and exposes First/Next navigation. A page
may be empty while still offering Next when stale stored rows were scanned.

## Moments View

`/moments` lists saved reader sections. Rows open the source reader at the
stored section anchor and expose Moment deletion. A Moment selected on a
translated reader maps to its source-canonical section before it appears here.
The route uses the same URL-owned First/Next page model as `/flashbacks`.

## Add Memory

Add memory is a shared anchored `Popup` available from desktop/tablet rail and
phone tabs. It accepts one URL and has no dedicated route. Escape, outside
pointer dismissal, and successful completion use the shared popup lifecycle.
Rail and phone forms project one shell-owned URL, pending, error, and
idempotency attempt state. Dismissing or switching popovers cannot start a
duplicate request, and an unmounted form cannot navigate or close a later
popover when its request settles.

## Reader

The source route reads source `CONTENT.md`. A translated route renders only a
completed translation whose source hash, output hash, job row, and language
file are current.

Both reader variants support:

- GitHub Flavored Markdown, footnotes, tables, and task lists.
- Syntax highlighting.
- Sanitized HTML and controlled external embeds.
- Stable heading anchors and a live table-of-contents reading range.
- Variant-local Flashback marks and source-canonical Moments.
- Brilliant translation controls and variant tabs.
- The memory-scoped Psychiatrist dock.

Text selection toggles Flashback ranges. Source and translated Flashbacks never
share offsets: translated writes include language and current output hash, and
only current rows render. Moment creation from translated content is validated
then mapped to the matching source section.

Psychiatrist appears only on ready source and translated readers. It creates or
resumes a thread for the active memory variant through TRAUMA APIs; the browser
never connects directly to Codex app-server.

External embeds may auto-load only after reader sanitization and media URL
policy. This has privacy/network effects and must not be expanded to unsafe or
private targets.

## Styling Boundary

Tailwind CSS v4 and semantic tokens own styling. Route and component classes
belong in JSX; sanitized reader markup may use narrowly scoped selectors in the
global stylesheet. Do not restore the removed broad `src/styles/app.css`
selector layer.
