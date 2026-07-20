# Reader And Content

## Reader Purpose

Reader mode is for reading extracted memory content. It is not a markdown
editor. The only direct text interaction is flashback toggling through text
selection.

## Reader Frame

Reader route frames use:

```text
trauma-route-surface trauma-reader-surface trauma-mobile-stable-viewport
w-full bg-trauma-bg-surface
```

The frame must fill the main pane. It must not centre itself independently
inside the shell.

## Reader Header

The reader header is sticky and route-local.

Contract:

- Back control links to `/memories`.
- Header uses the route frame background with backdrop blur.
- Header label is exactly `Memory`.
- Do not repeat the memory title in the sticky header. `MemoryReader` lifts the
  content title, or renders the memory title fallback, in the main reader intro.
- Do not render `Reader mode` copy.
- The main reader intro shows the source URL and memory actions.
- A safe source URL opens in a new tab.
- Source URL links use `text-trauma-link` and `hover:text-trauma-link-hover`.
- Unsafe or non-linkable source values render as text.

## Table Of Contents

The table of contents is a reader aid, not a global navigation panel. It is not
rendered inside the main reading column.

Contract:

- Registered by `MemoryReader` into the shell right rail while a ready memory
  route is mounted.
- The right-rail subtree is registered once per ready Reader mount. Reader-owned
  Flashbacks, Moments, and pending Moment state flow into that stable subtree
  through reactive accessors; state changes must not replace the subtree.
- Rendered as the first right rail island on ready source and translated reader
  routes.
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
- Toggling a Moment preserves the Flashbacks Current/All selection, the bounded
  TOC `scrollTop`, and the enclosing right-rail `scrollTop`.
- All Flashbacks loads lazily through the same bounded page loader as the
  canonical Flashbacks route. It renders one page at a time in a bounded scroll
  body and owns rail-local First/Previous/Next cursor history. Current remains
  memory-local and switching tabs does not reset the All page.
- When the bounded TOC body can scroll further, show a subtle blur fade only on
  the available scroll edge. At the top of the list this appears only after the
  user has scrolled down; at the bottom it disappears when no more content
  remains below. The fade starts at the scroll body edge and uses CSS mask
  gradients so the transition into unblurred content is soft.
- Entry uses `animate-trauma-pop-bounce` for a short popup-style bounce.
- Motion is disabled under `prefers-reduced-motion: reduce`.

### Reading-Progress Visualization

The TOC tracks the reader's live position and visualizes it as a background
treatment, so it doubles as a reading-progress indicator without losing its
static aids (anchors, scroll fades, Moment toggles, long-press menus).

- `MemoryReader` observes the rendered section headings
  (`[data-reader-section-anchor]`) inside the reading column. Each heading owns
  the section that runs to the next heading; a section counts as on screen when
  that span overlaps the viewport.
- The spy tracks whatever range is currently rendered on screen, not a single
  chapter. If the sections for several chapters are visible at once, every
  visible entry is highlighted. The result is always a contiguous slice of the
  TOC ordering; the topmost visible entry is the `leadId`.
- The reader and the right-rail TOC communicate this range through
  `MemoryReader`-owned reactive state passed down as props; the TOC never reads
  reader DOM.
- The range is painted by a single measured overlay element
  (`trauma-toc-reading-band`) positioned behind the entries, not per-row
  backgrounds. The overlay remains a presentation-only list item so the
  ordered list has valid direct-child semantics. Its top/height are measured
  from the first and last on-screen
  rows so the highlight is one seamless region with no visible seams between
  chapters. The fill is a subtle translucent contrast lift over the TOC surface
  (`color-mix(in srgb, var(--fg-1) 8%, transparent)`); background-only, it does
  not recolor or re-weight the spied section text. Only design tokens are used;
  no raw hex.
- The band eases its `top`/`height` with an elastic
  `cubic-bezier(0.34, 1.56, 0.64, 1)` transition, so moving between adjacent
  chapters reads as the band growing vertically out of the previous range into
  the next one rather than popping or switching instantly. The first paint is
  not animated (the band appears in place).
- The `leadId` entry carries `aria-current="location"` for assistive tech; this
  is semantic only and applies no visual emphasis.
- With nothing on screen mapped to a heading (empty TOC) the TOC renders in its
  plain static state with no highlight.
- The TOC body is bounded, so memories with many sections scroll inside it. When
  the spied range reaches a section outside that bounded viewport, the TOC
  auto-scrolls just enough to keep the range in view and follow the reader. This
  runs only on range changes, so manual TOC browsing is not interrupted until
  the reader scrolls the document again.
- Scroll observation is `requestAnimationFrame`-batched, attached as passive
  listeners, and fully torn down on reader unmount. Under
  `prefers-reduced-motion: reduce` the band only fades, its position no longer
  animates, and the follow-scroll jumps instantly instead of smoothing.

## Markdown Prose

Rendered markdown uses Tailwind Typography through `@tailwindcss/typography`.

The Markdown pipeline is deliberately split by responsibility:

- Reader display uses `markdown-it` for GFM-like rendering, footnotes, heading
  anchors/ToC metadata, and syntax highlighting, then sanitizes the generated
  HTML before adding TRAUMA-owned Moment controls.
- Auto-loaded image and iframe URLs pass through the reader media policy; the
  same-origin media proxy performs public-host, redirect, timeout, byte-limit,
  and raster-content checks before a browser can load remote images.
- Translation uses the `unified`/Remark AST only for structural segmentation,
  projection, and validation. That AST pipeline does not render browser HTML.

Keep these boundaries separate. A future parser replacement must preserve the
same heading IDs and paths, code output, tables/tasks/footnotes, sanitizer and
embed policy, ToC metadata, and `data-flashback-id` semantics before removing
either implementation.

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

Selecting reader text opens the reader selection-actions menu; selection alone
does not change persisted or rendered flashback state. Activating `Flashback
selection` from that menu toggles flashback state:

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

The translation popover treats Codex model-catalog load failure as actionable
async feedback. Its assertive `role="alert"` keeps the error and a Retry action
visible without relying on color. Retry is disabled while its request is pending;
after recovery started from the focused Retry control, focus moves to the
restored Model control unless the user moved focus elsewhere.

## Psychiatrist Dock

Psychiatrist uses a bottom-centered floating home-bar affordance on ready reader
routes. The collapsed state is a small pill at the bottom of the viewport; it
must not cover the reader title, selection menu, right rail, or bottom shell
navigation. The expanded state is a compact chat panel anchored to that home bar
and keeps the reader page usable around it.

The dock creates or resumes the active memory variant's latest thread. Stored
pair history returned by the thread API is rendered as user prompt/assistant
response rows. Safe process/status events are visually subordinate to answer
text, and hidden chain-of-thought or raw backend payloads are never rendered.
The browser normalizes and coalesces adjacent duplicate status text, retains the
first context row plus the latest seven rows per pair, and therefore renders at
most eight process rows for each visible pair. Answer deltas remain one answer
projection and are not subject to process redaction or coalescing.

Interaction contract:

- Submit becomes Stop while a turn is running.
- Plain Enter submits only when the prompt textarea owns the keyboard event.
  Shift+Enter remains a newline. Enter during IME composition, including the
  legacy `keyCode = 229` signal, must not be prevented or submitted.
- Stop is the only UI action that calls the cancel route.
- Panel close, Escape, route unmount, memory navigation, and browser reload do
  not cancel the server turn.
- Route lifecycle cleanup closes the browser `EventSource` connection only.
- A named terminal SSE frame closes its `EventSource` before payload parsing. If
  that terminal payload is malformed, the browser performs at most one
  canonical same-reader/thread/turn reload and never calls cancel. A failed
  reload or a second malformed terminal for that turn exposes the existing
  manual thread Retry action instead of creating an automatic reconnect loop.
- Returning to the same memory resumes the latest matching thread and reconnects
  to `active_turn.event_url` when present.
- Completed responses expose Regenerate. Regenerate streams into the same pair
  row and replaces the visible answer on the first new answer delta.
- `network_permission_required` is shown as a per-turn permission state: the
  user must explicitly allow web search/source lookup for that answer before any
  web-source turn may run.
- Citation wire values remain compatible strings. Only credential-free public
  `http:` and `https:` URLs become links; malformed URLs, active-content schemes,
  localhost names, and non-public IP literals remain visible as inert source
  title text.
- The full thread response remains the canonical in-memory transcript. The DOM
  projects fixed 24-pair Older/Newer pages from it, pins an out-of-page active
  pair and the latest persisted web-source retry pair, and never renders more
  than 26 pair rows. Pins are deduplicated and stay in transcript chronology.
  The polite range label reports each out-of-page pin by one-based transcript
  number and active or web-source-retry reason; pins already in the page do not
  change the ordinary range label.
- Opening the dock, loading a different thread, or appending a new prompt shows
  the most recent page. Same-thread reconciliation preserves the current page.
  Page controls target the transcript with `aria-controls`, announce the visible
  range politely, keep keyboard focus stable, and move the transcript viewport
  to the top without a live stream update stealing that reading position.
- Opening an unloaded dock focuses the enabled Close control while the prompt is
  disabled. Initial readiness hands focus to the prompt only when the same dock
  opening is still active and focus remains on Close. User focus movement,
  panel close, and background reconciliation never steal focus; load failure
  leaves Retry keyboard-reachable.
- Opening the dock, completing its initial thread load, or appending a new user
  prompt scrolls the transcript to its bottom. Streaming output follows only
  when the transcript was within 48 px of the bottom before that update; a user
  who scrolls upward keeps that reading position. Deferred scroll writes must be
  canceled by a newer manual scroll, reader generation, close, or unmount.

Motion follows the reader's accessibility contract. Normal expansion may animate
from the home bar, but `prefers-reduced-motion: reduce` disables transform-heavy
motion and keeps the open/close transition usable on mobile and desktop.
