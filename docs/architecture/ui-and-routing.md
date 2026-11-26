# UI And Routing Architecture

This document owns the canonical route and responsive-shell contract. The
[design system](../references/design-system/INDEX.md) owns visual and
accessibility details without redefining route availability.

## Canonical Routes

- `/memories`: focus-first browse lanes (`Today` default, `?lane=shelf`, `?lane=library`), search, Library filters, triage actions, and memory actions.
- `/memories/:id`: source reader.
- `/memories/:langCode/:id`: current translated reader.
- `/flashbacks`: renderable source and translated Flashback excerpts.
- `/moments`: source-canonical section bookmarks.
- `/settings`: translation defaults, Codex model/effort, Codex auth state, and Focus plugin settings.

`/` redirects to `/memories`. `/highlights` redirects to `/flashbacks` and
`/flashback` redirects to `/moments` only for legacy compatibility; do not link
to them or use their retired terminology in new contracts.

`/category`, `/tags`, `/backup`, and `/memories/new` are not routes. Categories
and tags are managed inline in the reader's `⋯` Details & Actions overflow
popover and filtered inside the Library `Filters` popover. Backup is exposed
through status/failsafe surfaces. Add memory is a global shell popover and
Command Palette capture mode.

## Browse Query State

`/memories` owns lane, filter, and search state in the URL:

```text
/memories?lane=today|shelf|library&q=...&category=...&tag=...&flashback=...&view=list|grid
```

- **Today** (default, `/memories`): picked items (`triage_state = 'today'`),
  capped by the `ephemeral-shelf-triage` `dailyPickCap` setting (default `3`),
  showing a neutral resume cue (`continue at section K/N`) when `last_position`
  exists.
- **Shelf** (`/memories?lane=shelf`): newly captured items (`triage_state = 'shelf'`)
  for low-friction deferred triage. Visible controls use destination labels
  (`Today`, `Library`, `Archive`), and focused rows support one-key triage:
  `p` (`Today`), `l` (`Library`), `x` (`Archive`), and `u` (Undo).
  `ephemeral-shelf-triage` supplies optional TTL expiry and Today cap
  parameters; `EphemeralShelfBar` has been removed.
- **Library** (`/memories?lane=library`): kept memories (`triage_state = 'library'`)
  with search and an on-demand `Filters` popover for categories, tags, and
  Flashbacks.

No unread debt counters, overdue badges, streaks, or numeric backlog prompts
appear on any browse lane.

`q` supports free text, `title:`, `url:`, `tag:`, `category:`, `flashback:`, and
standalone `read`/`unread` terms. Search covers memory metadata, taxonomy, and
renderable Flashback text/context, not the full reader body. Explicit taxonomy
and Flashback query keys combine with search terms rather than clearing them.

Memory results are cursor-paginated, and `view=list|grid` remains
URL-addressable.

`/flashbacks` and `/moments` use an opaque `cursor` query value. The URL is the
page source of truth: Next writes the continuation cursor, First removes it,
and browser Back or Reload restores that exact page. These routes render only
the current page; they never append earlier pages to the DOM.

## Shell Layout

Desktop and tablet (`min-width: 721px`):

- Slim `56px` icon-only left rail (`Today`, `Shelf`, `Library`, `Flashbacks`,
  `Moments`, `Settings`, plus `Add`, `Search / Palette`, and `Theme` popovers).
- Centered route-owned main canvas (`max-width: 920px`).
- No persistent right rail (`right-rail-context.tsx` is removed).
- On reader routes, the left rail auto-hides on downward scroll and reveals on
  upward scroll, left-edge pointer proximity, or keyboard focus.
- `Cmd/Ctrl+K` opens the global Command Palette from any route for search,
  navigation, URL capture, and Focus plugin toggles.

Phone (`max-width: 720px`):

- Compact brand header with Search/Palette and Capture actions, route main pane,
  and fixed bottom `Primary tabs` bar.
- Exactly four live bottom tabs: `Today`, `Shelf`, `Library`, and `More`
  (which opens a sheet for `Flashbacks`, `Moments`, `Settings`, and `Theme`).
- No disabled placeholder tabs and no side filter drawer.

The shell owns global chrome, Command Palette, composer/theme popup state, and
backup alert. Routes own headers, controls, loading/empty/error states, and
content. Responsive route/component sizing should use the shared fluid and
container-query utilities rather than device-specific wrappers.

## Flashbacks View

`/flashbacks` renders dense excerpt rows. Each row shows muted prefix/suffix
context, selected text as the focal content, and the memory title as subordinate
metadata. Its link opens the matching source or translated reader at the
Flashback anchor.

Library `Filters` may filter `/memories?lane=library` with `flashback=<id>`.
They do not replace direct reader links from the canonical Flashbacks route.
The route uses a bounded server page and exposes First/Next navigation. A page
may be empty while still offering Next when stale stored rows were scanned.

## Moments View

`/moments` lists saved reader sections. Rows open the source reader at the
stored section anchor and expose Moment deletion. A Moment selected on a
translated reader maps to its source-canonical section before it appears here.
The route uses the same URL-owned First/Next page model as `/flashbacks`.

## Add Memory

Add memory is a shared anchored `Popup` (and Command Palette capture mode)
available from the left rail and phone header. It accepts one URL, never opens
a taxonomy prompt, and lands new items in `triage_state = 'shelf'`. Escape,
outside pointer dismissal, and successful completion use the shared popup
lifecycle. Rail and palette forms project one shell-owned URL, pending, error,
and idempotency attempt state. Dismissing or switching popovers cannot start a
duplicate request, and an unmounted form cannot navigate or close a later
popover when its request settles.

## Reader

The source route reads source `CONTENT.md`. A translated route renders only a
completed translation whose source hash, output hash, job row, and language
file are current.

Both reader variants use the focus-first layout (`docs/architecture/focus-first-ui.md`):

- Centered single-column reading canvas bound by `--reader-measure` (default
  `66ch`, range `55ch–75ch`) whose width and horizontal position stay stable
  when any reader micro-surface opens.
- Auto-hiding top bar with back link, truncated title, variant tabs with a
  co-located `+ Translate` popover trigger, and a quiet `⋯` overflow popover
  trigger for rare metadata and management actions (URL, captured date, read
  status, categories, tags, delete). No `Inspector` trigger or multi-tab side
  drawer exists (revised D5).
- Collapsed-by-default left landmark rail showing section progress dots
  (`section K of N`, never minutes left) that expands on hover or focus into a
  unified Outline + Marks panel (TOC headings, Moments, and current-memory
  Flashbacks).
- Selection-anchored in-situ AI margin notes (`Simplify`, `Explain`, `Ask`)
  grounded on the selected passage without opening a docked chat sidebar, plus
  an on-demand `Psychiatrist` sheet (`role="dialog"`, `z-50`) for escalated
  threads (see [`focus-first-ui.md`](./focus-first-ui.md) AC 15 for the full
  entry contract).
- Core `last_position` persistence (debounced on scroll and flushed on route
  leave) with silent restore on reopen; `ResumptionBeacon` reads core
  `last_position` to add visual resumption cues without duplicating persistence.
- Quiet end-of-article footer (`Library` / `Archive` / `Shelf` plus optional
  3-state focus pulse when plugins or experiment logs are active) and automatic
  `read` completion at `>= 75%` depth with `>= 20s` dwell (reversible in the
  `⋯` popover).
- GitHub Flavored Markdown, footnotes, tables, task lists, syntax highlighting,
  sanitized HTML, controlled external embeds, variant-local Flashback marks,
  and source-canonical Moments.
- Reader plugin overlays (`ReadingRulerOverlay`, `ResumptionBeacon`) mount
  above reader text and below the Psychiatrist sheet (`z-40` vs sheet `z-50`);
  `AdaptiveAiResponse` mounts inside in-situ AI margin cards and the on-demand
  Psychiatrist sheet.

Text selection opens the selection-actions menu for toggling Flashback ranges,
marking Moments, or invoking in-situ AI margin notes (`Simplify`, `Explain`,
`Ask`). Source and translated Flashbacks never share offsets: translated writes
include language and current output hash, and only current rows render. Moment
creation from translated content is validated then mapped to the matching
source section.

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
