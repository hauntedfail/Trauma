# Reader And Content

## Reader Purpose

Reader mode is for reading extracted memory content. It is not a markdown
editor. Direct text interaction is limited to the text-selection menu
(Flashback toggling, section Moment toggling when applicable, and in-situ AI
margin notes: `Simplify`, `Explain`, `Ask`).

## Reader Frame And Measure

Reader route frames use a centered single-column canvas bound by
`--reader-measure` (default `66ch`, clamped to `55ch–75ch`; CJK languages
override measure via `:lang(ja)` / `:lang(zh)` at `40ic` and `:lang(ko)` at
`42ic`):

```text
trauma-route-surface trauma-reader-surface trauma-mobile-stable-viewport
w-full bg-trauma-bg-surface
```

The reading column's computed width and horizontal position remain fixed when
any reader popover, landmark rail, or on-demand Psychiatrist sheet opens.

## Reader Header (Auto-Hiding Top Bar)

The reader top bar (`.trauma-reader-topbar`) is sticky and auto-hides on
downward scroll, revealing on upward scroll or keyboard focus.

Contract:

- Back control links to `/memories`.
- Shows truncated title, compact language variant tabs (`ReaderVariantTabs`)
  when translations exist, an inline `+ Translate` popover trigger
  (`data-reader-translate-trigger`) co-located next to the variant tabs, and a
  quiet `⋯` overflow popover trigger (`data-reader-details-trigger`,
  `aria-label="Memory details and actions"`).
- Does not render an `Inspector` button, taxonomy chips, source metadata
  clutter, or `Reader mode` copy above the article.
- `prefers-reduced-motion: reduce` disables the slide/fade transition.

## Spatially Contiguous Reader Micro-Surfaces

Peripheral reader aids do not occupy a persistent right rail or a multi-tab
Inspector drawer (revised D5). Instead, each secondary control is co-located
where its need arises and remains hidden during active reading:

- **Left landmark rail** (`.trauma-reader-landmark-rail`): collapsed by default
  to compact section progress dots (`section K of N`, never minutes left),
  expanding on hover or focus into a unified **Outline + Marks** panel
  (`data-reader-landmark-panel`) containing the bounded table of contents
  (with live reading-range spy and Moment toggles) plus current-memory Moments
  and Flashbacks (`data-reader-landmark-marks`) with zero count badges.
- **Top-bar Translate popover** (`#reader-translate-popover`,
  `data-reader-translate-trigger`, `role="dialog"`): co-located right next to
  `ReaderVariantTabs`. Hosts the Brilliant translation form (language, model,
  reasoning effort), live SSE translation progress, and accessible
  retry-on-catalog-error controls. Escape closes and returns focus to the
  trigger.
- **Top-bar Details & Actions overflow popover** (`#reader-details-popover`,
  `data-reader-details-trigger`, `aria-label="Memory details and actions"`,
  `role="dialog"`): quiet `⋯` trigger hosting rare metadata and management
  controls — source URL (safe links open in a new tab using
  `text-trauma-link`), captured date, read-state toggle, categories, tags, and
  delete/category action menu (`MemoryActionMenu`). Escape closes the topmost
  popup first and returns focus to the trigger.
- **In-situ AI margin note card** (`.trauma-reader-margin-note`,
  `data-reader-margin-note`, `role="complementary"`): opens from the text
  selection menu (`Simplify`, `Explain`, `Ask`) with automatic passage and
  section context, renders the passage snippet and `AdaptiveAiResponse` output
  (or a compact bottom sheet on narrow viewports), supports follow-up questions,
  dismisses on `Escape` or Close with focus return, and offers
  `Continue in Psychiatrist` to escalate to a full thread.
- **On-demand Psychiatrist sheet** (`.trauma-reader-psychiatrist-sheet`,
  `#reader-psychiatrist-sheet`, `role="dialog"`, `z-index: 50`, built on
  `TraumaSheet` / `@corvu/drawer`): opens on demand without a 5-tab Inspector
  drawer, from the `Psychiatrist` action in the `⋯` overflow popover, the
  `Open Psychiatrist` command-palette command on reader routes, the `]`
  keyboard shortcut, or a margin note's `Continue in Psychiatrist` action
  ([`focus-first-ui.md`](../../architecture/focus-first-ui.md) AC 15). Closing
  returns focus to the control that opened it; opened from the palette, focus
  returns to the reader column. Mounts the memory-scoped `PsychiatristDock`
  (`embedded`) with `AdaptiveAiResponse` when enabled; Escape, backdrop click on
  narrow viewports, or Close dismisses the sheet.
- **Reader focus plugin overlays**: `ReadingRulerOverlay` and `ResumptionBeacon`
  mount in the overlay layer above text and below the Psychiatrist sheet
  (`z-40`). `ResumptionBeacon` reads core `last_position` and adds only visual
  cues without duplicating persistence.
- **Quiet end-of-article footer**: offers destination-explicit `Library`,
  `Archive`, and `Shelf` triage controls (D11), plus the 3-state focus pulse
  when plugins or experiment logs are active. Reaching `>= 75%` scroll depth
  with `>= 20s` dwell automatically marks `read` (reversible in the `⋯` menu).

## Table Of Contents & Marks (Left Landmark Rail)

The table of contents and current-memory Marks are reader aids mounted inside
the expanded left Landmark Rail, not inside the main reading column.

Contract:

- Rendered inside the expanded left Landmark Rail on ready source and
  translated reader routes.
- Hidden from `/memories`, `/flashbacks`, and other non-reader routes.
- Text is compact.
- Links target generated markdown heading anchors and use the reader link
  token on hover.
- Heading entries are left-aligned inside the panel. Do not add global list
  padding; reserve only the small Moment affordance slot and use heading-level
  indentation for hierarchy.
- Heading links live inside a bounded scroll body so many headings do not expand
  the landmark panel or the whole app layout.
- Current-memory Moments and Flashbacks render in a bounded Marks section below
  the outline with zero numeric count badges.
- When the bounded TOC body can scroll further, show a subtle blur fade only on
  the available scroll edge.
- Motion (Psychiatrist sheet, top bar, landmark rail, beacon highlight fade,
  reading ruler) is disabled under `prefers-reduced-motion: reduce`.

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
- The reader and the landmark-rail TOC communicate this range through
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

### Multilingual Typography & Language Detection

`MemoryReader` detects each rendered article's BCP-47 language tag and text
direction via `detectArticleLanguage` and `isRtlLanguage`
(`src/lib/language-detect.ts`), preferring an explicit variant `langCode` and
otherwise inspecting Unicode script ratios. It binds `lang` and `dir` (`rtl`
for `ar`, `fa`, `he`, `ur`, `yi`, `ps`, `sd`; `ltr` otherwise) on the reading
column.

- English (`en`) and Japanese (`ja`) fonts are eagerly self-hosted from
  `src/styles/fonts.ts`.
- Other supported scripts (`ko`, `zh-Hans`, `zh-Hant`, `ar`/`fa`/`ur`,
  `hi`/`mr`, `th`) are loaded on demand by `ensureMultilingualFontLoaded`
  (`src/lib/multilingual-fonts.ts`) via dynamic `import()` of their
  `@fontsource*` packages.
- Scoped `:lang(...)` rules in `src/styles/tailwind.css` tune leading, font
  fallback, and line breaking per script:
  - `:lang(ja)`: `--reader-leading: 1.85`, `line-break: strict`,
    `text-autospace: normal`, plus `"palt" 1` and `word-break: auto-phrase` on
    `h1`–`h3`.
  - `:lang(ko)`: `--reader-leading: 1.75`, `Noto Sans KR Variable`,
    `word-break: keep-all`.
  - `:lang(zh-Hans)` / `:lang(zh-Hant)`: `--reader-leading: 1.85`,
    `Noto Sans SC Variable` / `Noto Sans TC Variable`, `line-break: strict`,
    `text-autospace: normal`.
  - `:lang(ar)`, `:lang(fa)`, `:lang(ur)`: `--reader-leading: 1.85`,
    `IBM Plex Sans Arabic`, `letter-spacing: 0 !important`.
  - `:lang(hi)`, `:lang(mr)`: `--reader-leading: 1.8`,
    `Noto Sans Devanagari Variable`.
  - `:lang(th)`: `--reader-leading: 1.8`, `Noto Sans Thai Variable`.

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

Flashback browse excerpts and landmark-rail marks use the shared
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

On ready reader routes, `PsychiatristDock` mounts in `embedded` mode inside the
on-demand `#reader-psychiatrist-sheet` (`TraumaSheet`) dialog rather than as a
docked sidebar or floating bottom pill. No chat surface is open or docked on
the reading surface by default (D12).

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
  leaves Retry keyboard-reachable. A retry started from the focused Retry
  control first hands focus to stable Close while the error action unmounts,
  then hands it to the enabled prompt only after the same retry succeeds and
  focus still remains on Close.
- Opening the dock, completing its initial thread load, or appending a new user
  prompt scrolls the transcript to its bottom. Streaming output follows only
  when the transcript was within 48 px of the bottom before that update; a user
  who scrolls upward keeps that reading position. Deferred scroll writes must be
  canceled by a newer manual scroll, reader generation, close, or unmount.

Motion follows the reader's accessibility contract. Normal expansion may animate
on open/close, but `prefers-reduced-motion: reduce` disables transform-heavy
motion and keeps the open/close transition usable on mobile and desktop.
